import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import { updateStoreSchema } from "./validation";
import { planStoreLanguages, storeLanguages, toStoreSettings } from "../../../../cod-shared/stores/settings";
import { NotFoundError, SystemError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import type { z } from "@hono/zod-openapi";
import { mediaDeliveryOf, mediaOf, releaseShown } from "@/lib/media";

export async function getMyStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  
  if (!store) {
    throw new NotFoundError("Store");
  }

  const localeRows = await queries.listStoreLocales(db, store.id);
  return c.json({ success: true, data: toStoreSettings(store, localeRows, mediaDeliveryOf(c.env)) }, 200);
}

export async function updateMyStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);

  if (!store) {
    throw new NotFoundError("Store");
  }

  const jsonBody: any = (c.req as any).valid?.("json");
  const { languages, ...columns } = (jsonBody ?? updateStoreSchema.parse(await c.req.json())) as z.infer<
    typeof updateStoreSchema
  >;
  const current = await queries.listStoreLocales(db, store.id);
  const plan = planStoreLanguages(
    { lang: columns.lang, languages },
    { lang: store.lang, rows: storeLanguages(store.lang, current) },
  );
  if (!plan.ok) {
    throw new ValidationError(
      "The store's primary language must be in its languages and published",
      ERROR_CODES.VALIDATION_FAILED,
    );
  }
  for (const key of [columns.logoKey, columns.ogImageKey]) if (key) await mediaOf(c.env).ready(key);
  const updated = await queries.updateStore(db, store.id, columns, plan.rows);
  if (!updated) {
    throw new SystemError("Failed to update store");
  }
  const replaced = [store.logoKey, store.ogImageKey].filter((key): key is string => key !== null && key !== updated.logoKey && key !== updated.ogImageKey);
  await releaseShown(c.env, replaced, `store ${store.id}`);
  const localeRows = plan.rows ?? current;
  return c.json({ success: true, data: toStoreSettings(updated, localeRows, mediaDeliveryOf(c.env)) }, 200);
}
