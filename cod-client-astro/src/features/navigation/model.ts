/**
 * The Navigation screen's logic — everything that isn't a fetch or a pixel.
 * What a menu may hold (its depth, its size, a handle, a URL) is decided once
 * in cod-shared/navigation/menus.ts; this file only edits the tree the
 * merchant sees and checks it against those rules before it is sent.
 *
 * Like the other feature models, it does not import `ApiError` (that module
 * needs Astro's env); `isApiError` duck-types the one property it reads.
 */
import { MENU_HANDLE_RE, MENU_MAX_DEPTH, MENU_MAX_ITEMS, isMenuUrl } from "../../../../cod-shared/navigation/menus";
import type { MenuDestination, MenuItemInput, MenuItemNode } from "./types";

export { MENU_MAX_DEPTH, MENU_MAX_ITEMS };

/** An item while the merchant edits it: `key` names it on screen, `id` once the server has it. */
export interface EditableItem {
  key: string;
  id?: string;
  label: string;
  destination: MenuDestination;
  /** What the destination is called, for the row; null for the home, the catalog and a URL. */
  destinationLabel: string | null;
  /** As last saved; null once the destination changed on screen (unknown until saved). */
  destinationStatus: MenuItemNode["destinationStatus"] | null;
  children: EditableItem[];
}

let counter = 0;
export const newKey = () => `new-${++counter}`;

export function fromServer(items: readonly MenuItemNode[]): EditableItem[] {
  return items.map((item) => ({
    key: item.id,
    id: item.id,
    label: item.label,
    destination: item.destination,
    destinationLabel: item.destinationLabel,
    destinationStatus: item.destinationStatus,
    children: fromServer(item.children),
  }));
}

export function toInput(items: readonly EditableItem[]): MenuItemInput[] {
  return items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    label: item.label.trim(),
    destination: item.destination,
    ...(item.children.length ? { children: toInput(item.children) } : {}),
  }));
}

/** A handle from a title: `Main menu` → `main-menu`. Script that has no Latin letters gives `menu`. */
export function handleFromTitle(title: string): string {
  const handle = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return handle || "menu";
}

export const isValidHandle = (handle: string) => MENU_HANDLE_RE.test(handle);

export function countItems(items: readonly EditableItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);
}

/** Levels below and including the item: 1 for a leaf. */
function height(item: EditableItem): number {
  return 1 + Math.max(0, ...item.children.map(height));
}

interface Location {
  siblings: EditableItem[];
  index: number;
  /** 1 for a top-level item. */
  depth: number;
  parent: EditableItem | null;
}

function locate(items: EditableItem[], key: string, depth = 1, parent: EditableItem | null = null): Location | null {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.key === key) return { siblings: items, index, depth, parent };
    const found = locate(item.children, key, depth + 1, item);
    if (found) return found;
  }
  return null;
}

const clone = (items: readonly EditableItem[]): EditableItem[] => items.map((item) => ({ ...item, children: clone(item.children) }));

export function depthOf(items: readonly EditableItem[], key: string): number {
  return locate(clone(items), key)?.depth ?? 0;
}

export function updateItem(items: readonly EditableItem[], key: string, change: Partial<Omit<EditableItem, "key" | "children">>): EditableItem[] {
  return items.map((item) =>
    item.key === key ? { ...item, ...change } : { ...item, children: updateItem(item.children, key, change) },
  );
}

/** Adds at the end of the top level, or under `parentKey` when one more level fits. */
export function addItem(items: readonly EditableItem[], item: EditableItem, parentKey: string | null = null): EditableItem[] {
  if (parentKey === null) return [...clone(items), item];
  const tree = clone(items);
  const at = locate(tree, parentKey);
  if (!at || at.depth >= MENU_MAX_DEPTH) return tree;
  at.siblings[at.index]!.children.push(item);
  return tree;
}

/** Removes the item and everything under it. */
export function removeItem(items: readonly EditableItem[], key: string): EditableItem[] {
  return items.filter((item) => item.key !== key).map((item) => ({ ...item, children: removeItem(item.children, key) }));
}

export function canMove(items: readonly EditableItem[], key: string, direction: "up" | "down"): boolean {
  const at = locate(clone(items), key);
  if (!at) return false;
  return direction === "up" ? at.index > 0 : at.index < at.siblings.length - 1;
}

export function moveItem(items: readonly EditableItem[], key: string, direction: "up" | "down"): EditableItem[] {
  const tree = clone(items);
  const at = locate(tree, key);
  if (!at || !canMove(items, key, direction)) return tree;
  const target = direction === "up" ? at.index - 1 : at.index + 1;
  [at.siblings[at.index], at.siblings[target]] = [at.siblings[target]!, at.siblings[at.index]!];
  return tree;
}

/** Under the item above it, when there is one and the item's levels still fit. */
export function canIndent(items: readonly EditableItem[], key: string): boolean {
  const at = locate(clone(items), key);
  return !!at && at.index > 0 && at.depth + height(at.siblings[at.index]!) <= MENU_MAX_DEPTH;
}

export function indentItem(items: readonly EditableItem[], key: string): EditableItem[] {
  const tree = clone(items);
  if (!canIndent(items, key)) return tree;
  const at = locate(tree, key)!;
  const [item] = at.siblings.splice(at.index, 1);
  at.siblings[at.index - 1]!.children.push(item!);
  return tree;
}

export function canOutdent(items: readonly EditableItem[], key: string): boolean {
  return (locate(clone(items), key)?.depth ?? 1) > 1;
}

/** Out to its parent's level, right after the parent. */
export function outdentItem(items: readonly EditableItem[], key: string): EditableItem[] {
  const tree = clone(items);
  const at = locate(tree, key);
  if (!at || !at.parent) return tree;
  const parentAt = locate(tree, at.parent.key)!;
  const [item] = at.siblings.splice(at.index, 1);
  parentAt.siblings.splice(parentAt.index + 1, 0, item!);
  return tree;
}

export type ItemProblem = "label" | "destination" | "url";

/** What keeps an item from being saved, if anything. */
export function itemProblem(item: Pick<EditableItem, "label" | "destination">): ItemProblem | null {
  const label = item.label.trim();
  if (!label || label.length > 100) return "label";
  const destination = item.destination;
  if (destination.type === "url") return isMenuUrl(destination.url.trim()) ? null : "url";
  if ("ref" in destination && !destination.ref) return "destination";
  return null;
}

/** Whether the tree may be sent: no item with a problem, and no more items than a menu holds. */
export function treeProblem(items: readonly EditableItem[]): "too_many" | "item" | null {
  if (countItems(items) > MENU_MAX_ITEMS) return "too_many";
  const walk = (list: readonly EditableItem[]): boolean => list.some((item) => itemProblem(item) !== null || walk(item.children));
  return walk(items) ? "item" : null;
}

/** Duck-types `@/lib/api`'s `ApiError` — see the module comment. */
function isApiError(value: unknown): value is { code?: string } {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "ApiError";
}

/** A thrown error as a message in the merchant's language — never the server's own text. */
export function menusErrorMessage(cause: unknown, t: (key: string) => string): string {
  if (isApiError(cause)) {
    switch (cause.code) {
      case "DUPLICATE_MENU_HANDLE":
        return t("errors.handle_taken");
      case "MENU_NOT_FOUND":
        return t("errors.not_found");
      case "INVALID_MENU_ITEMS":
      case "VALIDATION_FAILED":
        return t("errors.validation");
    }
  }
  return t("errors.generic");
}
