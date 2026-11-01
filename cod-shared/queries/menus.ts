/**
 * Navigation menus: the dashboard's reads and writes, and the storefront's
 * resolved menu.
 *
 * A menu's items are saved whole (`saveMenuItems`): the dashboard edits a
 * tree, so it sends the tree, and one batch replaces the old one — no item
 * can be half-moved. The storefront reads a menu by handle
 * (`resolveStorefrontMenu`): every item becomes a label in the shopper's
 * language and a path, and an item whose destination is gone or not public
 * (a deleted product, a draft page) is left out — a shopper never meets a
 * link to nowhere. The dashboard sees those items as broken
 * (`getMenu` → `destinationStatus`).
 */
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { collections, landingPages, productCategories, products, storeMenuItems, storeMenus, storePages } from "../db/schema";
import type { AppDb } from "../db/client";
import { DESTINATION_PAGE_TYPE, MENU_MAX_DEPTH, MENU_MAX_ITEMS, MENU_RESOURCE_DESTINATIONS, isPageDestination, type MenuDestination } from "../navigation/menus";
import { storefrontPath } from "../storefront/routes";
import { listTranslations } from "./translations";
import { safeLikeTerm } from "./search";
import type { StoreLocale } from "../i18n/locales";

export interface MenuSummary {
  id: string;
  handle: string;
  title: string;
  itemCount: number;
  updatedAt: string;
}

/** An item as the merchant edits it. */
export interface MenuItemInput {
  /** Kept when the item already exists, so its translations follow it. */
  id?: string;
  label: string;
  destination: MenuDestination;
  children?: MenuItemInput[];
}

export interface MenuItemNode {
  id: string;
  label: string;
  destination: MenuDestination;
  /** Whether a shopper would see the item: its destination exists and is public. */
  destinationStatus: "ok" | "missing" | "hidden";
  /** What the destination is called (a product's or category's name, a page's slug), when it names one. */
  destinationLabel: string | null;
  children: MenuItemNode[];
}

export interface MenuDetail {
  id: string;
  handle: string;
  title: string;
  updatedAt: string;
  items: MenuItemNode[];
}

/** A menu as a storefront renders it. */
export interface StorefrontMenuItem {
  label: string;
  /** A path without a language prefix (`/products/robe`), or an absolute URL. */
  href: string;
  /** The page type it opens, or `url`. */
  type: MenuDestination["type"];
  children: StorefrontMenuItem[];
}

export interface StorefrontMenu {
  handle: string;
  title: string;
  items: StorefrontMenuItem[];
}

type ItemRow = typeof storeMenuItems.$inferSelect;

export type MenuItemsProblem =
  | { reason: "too_deep"; max: number }
  | { reason: "too_many"; max: number }
  | { reason: "duplicate_id"; id: string };

function destinationOf(row: ItemRow): MenuDestination {
  if (row.destinationType === "url") return { type: "url", url: row.url ?? "" };
  if (isPageDestination(row.destinationType)) return { type: row.destinationType };
  return { type: row.destinationType, ref: row.destinationRef ?? "" };
}

interface ResolvedTarget {
  status: "ok" | "missing" | "hidden";
  label: string | null;
  path: string | null;
}

/** Every destination of these items, looked up in one round trip. */
async function resolveTargets(db: AppDb, rows: readonly ItemRow[]): Promise<Map<string, ResolvedTarget>> {
  const ids = (type: string) => [...new Set(rows.filter((row) => row.destinationType === type && row.destinationRef).map((row) => row.destinationRef!))];
  const [productIds, categoryIds, pageIds, landingIds, collectionIds] = [ids("product"), ids("category"), ids("page"), ids("landing"), ids("collection")];
  const none = ["\u0000"];
  const [productRows, categoryRows, pageRows, landingRows, collectionRows] = await db.batch([
    db.select({ id: products.id, name: products.name, handle: products.handle, status: products.status, visibility: products.visibility, showInStore: products.showInStore }).from(products).where(inArray(products.id, productIds.length ? productIds : none)),
    db.select({ id: productCategories.id, name: productCategories.name, slug: productCategories.slug }).from(productCategories).where(inArray(productCategories.id, categoryIds.length ? categoryIds : none)),
    db.select({ id: storePages.id, slug: storePages.slug, status: storePages.status }).from(storePages).where(inArray(storePages.id, pageIds.length ? pageIds : none)),
    db.select({ id: landingPages.id, name: landingPages.name, slug: landingPages.slug, status: landingPages.status }).from(landingPages).where(inArray(landingPages.id, landingIds.length ? landingIds : none)),
    db.select({ id: collections.id, title: collections.title, handle: collections.handle }).from(collections).where(inArray(collections.id, collectionIds.length ? collectionIds : none)),
  ]);
  const targets = new Map<string, ResolvedTarget>();
  for (const row of productRows) {
    const shown = row.status === "ACTIVE" && row.visibility && row.showInStore;
    targets.set(`product:${row.id}`, { status: shown ? "ok" : "hidden", label: row.name, path: storefrontPath("product", { handle: row.handle }) });
  }
  for (const row of categoryRows) targets.set(`category:${row.id}`, { status: "ok", label: row.name, path: storefrontPath("category", { slug: row.slug }) });
  for (const row of pageRows) targets.set(`page:${row.id}`, { status: row.status === "published" ? "ok" : "hidden", label: row.slug, path: storefrontPath("page", { slug: row.slug }) });
  for (const row of collectionRows) targets.set(`collection:${row.id}`, { status: "ok", label: row.title, path: storefrontPath("collection", { handle: row.handle }) });
  for (const row of landingRows) targets.set(`landing:${row.id}`, { status: row.status === "published" ? "ok" : "hidden", label: row.name, path: storefrontPath("landing", { slug: row.slug }) });
  return targets;
}

function targetOf(row: ItemRow, targets: Map<string, ResolvedTarget>): ResolvedTarget {
  if (row.destinationType === "url") return { status: "ok", label: null, path: row.url };
  if (isPageDestination(row.destinationType)) return { status: "ok", label: null, path: storefrontPath(DESTINATION_PAGE_TYPE[row.destinationType]) };
  return targets.get(`${row.destinationType}:${row.destinationRef}`) ?? { status: "missing", label: null, path: null };
}

function tree<T>(rows: readonly ItemRow[], build: (row: ItemRow, children: T[]) => T | null): T[] {
  const byParent = new Map<string | null, ItemRow[]>();
  for (const row of rows) byParent.set(row.parentId, [...(byParent.get(row.parentId) ?? []), row]);
  const walk = (parent: string | null, depth: number): T[] =>
    depth > MENU_MAX_DEPTH
      ? []
      : (byParent.get(parent) ?? [])
          .sort((a, b) => a.position - b.position)
          .flatMap((row) => {
            const node = build(row, walk(row.id, depth + 1));
            return node === null ? [] : [node];
          });
  return walk(null, 1);
}

async function menuRows(db: AppDb, menuId: string) {
  return db.select().from(storeMenuItems).where(eq(storeMenuItems.menuId, menuId)).orderBy(asc(storeMenuItems.position)).all();
}

export interface MenuDestinationOption {
  id: string;
  label: string;
  /** Its public path, so the merchant sees where the link goes. */
  path: string;
  /** False for one shoppers cannot see now (a draft, an inactive product): it would be left out of the menu. */
  visible: boolean;
}

/**
 * What a menu item can point at, for the dashboard's picker: up to `limit`
 * products, categories, collections, store pages or landing pages whose name
 * (or slug, or handle) contains `query`.
 */
export async function searchMenuDestinations(
  db: AppDb,
  storeId: string,
  type: (typeof MENU_RESOURCE_DESTINATIONS)[number],
  query: string,
  limit = 20,
): Promise<MenuDestinationOption[]> {
  const term = `%${safeLikeTerm(query.trim())}%`;
  const matches = (...columns: SQLiteColumn[]) => (query.trim() ? or(...columns.map((column) => like(column, term))) : undefined);
  switch (type) {
    case "product": {
      const rows = await db
        .select({ id: products.id, name: products.name, handle: products.handle, status: products.status, visibility: products.visibility, showInStore: products.showInStore })
        .from(products)
        .where(matches(products.name, products.handle))
        .orderBy(desc(products.updatedAt))
        .limit(limit)
        .all();
      return rows.map((row) => ({ id: row.id, label: row.name, path: storefrontPath("product", { handle: row.handle }), visible: row.status === "ACTIVE" && row.visibility && row.showInStore }));
    }
    case "category": {
      const rows = await db
        .select({ id: productCategories.id, name: productCategories.name, slug: productCategories.slug })
        .from(productCategories)
        .where(matches(productCategories.name, productCategories.slug))
        .orderBy(asc(productCategories.position), asc(productCategories.name))
        .limit(limit)
        .all();
      return rows.map((row) => ({ id: row.id, label: row.name, path: storefrontPath("category", { slug: row.slug }), visible: true }));
    }
    case "page": {
      const rows = await db
        .select({ id: storePages.id, slug: storePages.slug, status: storePages.status })
        .from(storePages)
        .where(and(eq(storePages.storeId, storeId), matches(storePages.slug)))
        .orderBy(asc(storePages.position), asc(storePages.slug))
        .limit(limit)
        .all();
      return rows.map((row) => ({ id: row.id, label: row.slug, path: storefrontPath("page", { slug: row.slug }), visible: row.status === "published" }));
    }
    case "collection": {
      const rows = await db
        .select({ id: collections.id, title: collections.title, handle: collections.handle })
        .from(collections)
        .where(and(eq(collections.storeId, storeId), matches(collections.title, collections.handle)))
        .orderBy(asc(collections.title))
        .limit(limit)
        .all();
      return rows.map((row) => ({ id: row.id, label: row.title, path: storefrontPath("collection", { handle: row.handle }), visible: true }));
    }
    case "landing": {
      const rows = await db
        .select({ id: landingPages.id, name: landingPages.name, slug: landingPages.slug, status: landingPages.status })
        .from(landingPages)
        .where(matches(landingPages.name, landingPages.slug))
        .orderBy(desc(landingPages.updatedAt))
        .limit(limit)
        .all();
      return rows.map((row) => ({ id: row.id, label: row.name, path: storefrontPath("landing", { slug: row.slug }), visible: row.status === "published" }));
    }
  }
}

export async function listMenus(db: AppDb, storeId: string): Promise<MenuSummary[]> {
  const menus = await db.select().from(storeMenus).where(eq(storeMenus.storeId, storeId)).orderBy(asc(storeMenus.createdAt)).all();
  if (menus.length === 0) return [];
  const items = await db.select({ menuId: storeMenuItems.menuId }).from(storeMenuItems).where(inArray(storeMenuItems.menuId, menus.map((menu) => menu.id))).all();
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.menuId, (counts.get(item.menuId) ?? 0) + 1);
  return menus.map((menu) => ({ id: menu.id, handle: menu.handle, title: menu.title, itemCount: counts.get(menu.id) ?? 0, updatedAt: menu.updatedAt }));
}

export async function getMenu(db: AppDb, storeId: string, id: string): Promise<MenuDetail | null> {
  const menu = await db.select().from(storeMenus).where(and(eq(storeMenus.id, id), eq(storeMenus.storeId, storeId))).get();
  if (!menu) return null;
  const rows = await menuRows(db, menu.id);
  const targets = await resolveTargets(db, rows);
  const items = tree<MenuItemNode>(rows, (row, children) => {
    const target = targetOf(row, targets);
    return { id: row.id, label: row.label, destination: destinationOf(row), destinationStatus: target.status, destinationLabel: target.label, children };
  });
  return { id: menu.id, handle: menu.handle, title: menu.title, updatedAt: menu.updatedAt, items };
}

export async function createMenu(db: AppDb, storeId: string, input: { handle: string; title: string }): Promise<{ ok: true; id: string } | { ok: false; reason: "handle_taken" }> {
  const taken = await db.select({ id: storeMenus.id }).from(storeMenus).where(and(eq(storeMenus.storeId, storeId), eq(storeMenus.handle, input.handle))).get();
  if (taken) return { ok: false, reason: "handle_taken" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(storeMenus).values({ id, storeId, handle: input.handle, title: input.title, createdAt: now, updatedAt: now });
  return { ok: true, id };
}

export async function updateMenu(
  db: AppDb,
  storeId: string,
  id: string,
  input: { handle?: string; title?: string },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "handle_taken" }> {
  if (input.handle !== undefined) {
    const taken = await db.select({ id: storeMenus.id }).from(storeMenus).where(and(eq(storeMenus.storeId, storeId), eq(storeMenus.handle, input.handle))).get();
    if (taken && taken.id !== id) return { ok: false, reason: "handle_taken" };
  }
  const updated = await db
    .update(storeMenus)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(and(eq(storeMenus.id, id), eq(storeMenus.storeId, storeId)))
    .returning({ id: storeMenus.id });
  return updated.length ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function deleteMenu(db: AppDb, storeId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(storeMenus).where(and(eq(storeMenus.id, id), eq(storeMenus.storeId, storeId))).returning({ id: storeMenus.id });
  return deleted.length > 0;
}

/** The tree's shape problems, before anything is written. */
export function menuItemsProblem(items: readonly MenuItemInput[]): MenuItemsProblem | null {
  let count = 0;
  const seen = new Set<string>();
  const walk = (list: readonly MenuItemInput[], depth: number): MenuItemsProblem | null => {
    if (list.length > 0 && depth > MENU_MAX_DEPTH) return { reason: "too_deep", max: MENU_MAX_DEPTH };
    for (const item of list) {
      count += 1;
      if (item.id !== undefined) {
        if (seen.has(item.id)) return { reason: "duplicate_id", id: item.id };
        seen.add(item.id);
      }
      const problem = walk(item.children ?? [], depth + 1);
      if (problem) return problem;
    }
    return null;
  };
  const problem = walk(items, 1);
  if (problem) return problem;
  return count > MENU_MAX_ITEMS ? { reason: "too_many", max: MENU_MAX_ITEMS } : null;
}

/**
 * Replaces a menu's items with this tree, in one batch. An item keeping its
 * `id` is updated in place and keeps its translations; an item left out is
 * deleted with them. New items go in first and removals run last, so an item
 * moved out from under a removed parent is never swept away with it.
 */
export async function saveMenuItems(
  db: AppDb,
  storeId: string,
  menuId: string,
  items: readonly MenuItemInput[],
): Promise<{ ok: true } | { ok: false; reason: "not_found" } | ({ ok: false } & MenuItemsProblem)> {
  const menu = await db.select({ id: storeMenus.id }).from(storeMenus).where(and(eq(storeMenus.id, menuId), eq(storeMenus.storeId, storeId))).get();
  if (!menu) return { ok: false, reason: "not_found" };
  const problem = menuItemsProblem(items);
  if (problem) return { ok: false, ...problem };

  const existing = new Set((await db.select({ id: storeMenuItems.id }).from(storeMenuItems).where(eq(storeMenuItems.menuId, menuId)).all()).map((row) => row.id));
  const now = new Date().toISOString();
  const rows: Array<typeof storeMenuItems.$inferInsert> = [];
  const flatten = (list: readonly MenuItemInput[], parentId: string | null) =>
    list.forEach((item, position) => {
      const id = item.id !== undefined && existing.has(item.id) ? item.id : crypto.randomUUID();
      const destination = item.destination;
      rows.push({
        id,
        menuId,
        parentId,
        position,
        label: item.label.trim(),
        destinationType: destination.type,
        destinationRef: "ref" in destination ? destination.ref : null,
        url: destination.type === "url" ? destination.url : null,
        createdAt: now,
        updatedAt: now,
      });
      flatten(item.children ?? [], id);
    });
  flatten(items, null);

  const kept = new Set(rows.map((row) => row.id!));
  const removed = [...existing].filter((id) => !kept.has(id));
  await db.batch([
    db.update(storeMenus).set({ updatedAt: now }).where(eq(storeMenus.id, menuId)),
    ...rows.filter((row) => !existing.has(row.id!)).map((row) => db.insert(storeMenuItems).values(row)),
    ...rows
      .filter((row) => existing.has(row.id!))
      .map(({ id, createdAt: _createdAt, ...row }) => db.update(storeMenuItems).set(row).where(eq(storeMenuItems.id, id!))),
    ...(removed.length ? [db.delete(storeMenuItems).where(inArray(storeMenuItems.id, removed))] : []),
  ] as unknown as Parameters<AppDb["batch"]>[0]);
  return { ok: true };
}

/**
 * A menu as a shopper sees it, in `locale` (`null` = the store's primary
 * language): labels translated, destinations turned into paths, and every
 * item whose destination is missing or not public left out with its
 * children. Null when the store has no menu with this handle.
 */
export async function resolveStorefrontMenu(db: AppDb, storeId: string, handle: string, locale: StoreLocale | null): Promise<StorefrontMenu | null> {
  const menu = await db.select().from(storeMenus).where(and(eq(storeMenus.storeId, storeId), eq(storeMenus.handle, handle))).get();
  if (!menu) return null;
  const rows = await menuRows(db, menu.id);
  const [targets, translated] = await Promise.all([
    resolveTargets(db, rows),
    locale ? listTranslations(db, "menuItem", rows.map((row) => row.id), locale) : Promise.resolve([]),
  ]);
  const labels = new Map(translated.filter((row) => row.key === "label" && row.value.trim()).map((row) => [row.resourceId, row.value]));
  const items = tree<StorefrontMenuItem>(rows, (row, children) => {
    const target = targetOf(row, targets);
    if (target.status !== "ok" || !target.path) return null;
    return { label: labels.get(row.id) ?? row.label, href: target.path, type: row.destinationType, children };
  });
  return { handle: menu.handle, title: menu.title, items };
}
