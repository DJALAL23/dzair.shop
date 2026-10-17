import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { logActivity, ACTIONS } from "@/lib/activity";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getStore } from "../../../../cod-shared/queries/stores";
import { createMenu, deleteMenu, getMenu, listMenus, saveMenuItems, searchMenuDestinations, updateMenu } from "../../../../cod-shared/queries/menus";
import type { CreateMenuSchema, MenuDestinationQuerySchema, SaveMenuItemsSchema, UpdateMenuSchema } from "@/openapi/schemas/menus";

async function requireStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await getStore(db);
  if (!store) throw new NotFoundError("Store");
  return { db, store };
}

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

async function detailOrThrow(db: ReturnType<typeof getDb>, storeId: string, id: string) {
  const menu = await getMenu(db, storeId, id);
  if (!menu) throw new NotFoundError("Menu", id);
  return menu;
}

const handleTaken = (handle: string) =>
  new ConflictError(`Another menu already has the handle "${handle}"`, ERROR_CODES.DUPLICATE_MENU_HANDLE, { handle });

export async function list(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const data = await listMenus(db, store.id);
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function destinations(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const { type, q } = (c.req as unknown as { valid: (target: "query") => z.infer<typeof MenuDestinationQuerySchema> }).valid("query");
  const data = await searchMenuDestinations(db, store.id, type, q ?? "");
  return c.json({ success: true, data }, 200);
}

export async function get(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  return c.json({ success: true, data: await detailOrThrow(db, store.id, c.req.param("id")!) }, 200);
}

export async function create(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const input = body<z.infer<typeof CreateMenuSchema>>(c);
  const result = await createMenu(db, store.id, input);
  if (!result.ok) throw handleTaken(input.handle);
  await logActivity(db, c.get("user"), ACTIONS.MENU_CREATED, { type: "menu", id: result.id, label: input.title }, { handle: input.handle });
  return c.json({ success: true, data: await detailOrThrow(db, store.id, result.id) }, 201);
}

export async function update(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const input = body<z.infer<typeof UpdateMenuSchema>>(c);
  const result = await updateMenu(db, store.id, id, input);
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Menu", id);
  if (!result.ok) throw handleTaken(input.handle!);
  const menu = await detailOrThrow(db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.MENU_UPDATED, { type: "menu", id, label: menu.title }, input);
  return c.json({ success: true, data: menu }, 200);
}

export async function saveItems(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const { items } = body<z.infer<typeof SaveMenuItemsSchema>>(c);
  const result = await saveMenuItems(db, store.id, id, items);
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Menu", id);
  if (!result.ok) {
    const { ok: _ok, ...problem } = result;
    throw new ValidationError("The menu's items cannot be saved as sent", ERROR_CODES.INVALID_MENU_ITEMS, problem);
  }
  const menu = await detailOrThrow(db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.MENU_ITEMS_SAVED, { type: "menu", id, label: menu.title });
  return c.json({ success: true, data: menu }, 200);
}

export async function remove(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const menu = await detailOrThrow(db, store.id, id);
  await deleteMenu(db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.MENU_DELETED, { type: "menu", id, label: menu.title }, { handle: menu.handle });
  return c.json({ success: true, data: { id } }, 200);
}
