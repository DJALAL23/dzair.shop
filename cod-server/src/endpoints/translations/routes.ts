/**
 * Translation routes for merchant data (ADR 0005, phase C).
 *
 * One factory, mounted by each translatable resource's own router so a
 * translation is guarded by the same scopes as the resource it translates:
 *
 *   GET   {path}  the source fields and every language's translations, each
 *                 flagged `outdated` when its source changed after it was written
 *   PATCH {path}  a JSON Merge Patch (RFC 7396) of one language: a string sets
 *                 a field, `null` removes it, other fields are untouched
 *
 * A translation is only ever for one of the store's added languages other than
 * the primary — the resource's own columns already hold the primary text.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getDb, type AppDb } from "@/db";
import { defineRoute, type AuthStrategy } from "@/lib/route-builder";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import type { AppContext } from "@/types";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { STORE_LOCALES, type StoreLocale } from "../../../../cod-shared/i18n/locales";
import {
  OPTION_KEY_PREFIX,
  OPTION_TEXT,
  TRANSLATABLE,
  indistinctOptions,
  parseVariantOptions,
  sourceDigest,
  translatableSources,
  translationView,
  type TranslatableResource,
} from "../../../../cod-shared/i18n/translations";
import { sanitizeRichText } from "../../../../cod-shared/lib/rich-text";
import { getStore, listStoreLocales } from "../../../../cod-shared/queries/stores";
import { listResourceTranslations, writeTranslations } from "../../../../cod-shared/queries/translations";
import { storeLanguages } from "../../../../cod-shared/stores/settings";

export interface TranslationRoutesOptions {
  resource: TranslatableResource;
  /** Path on the mounting router, e.g. `/{id}/translations` or `/me/translations`. */
  path: string;
  read: AuthStrategy;
  write: AuthStrategy;
  /** The resource's own row by id (the path's `{id}`, or undefined for `/me`). */
  load: (db: AppDb, id: string | undefined) => Promise<({ id: string } & Record<string, unknown>) | null | undefined>;
  /** For the OpenAPI tag and the 404 message. */
  label: string;
  tag: string;
}

const translationValue = (maxLength: number) => z.string().trim().min(1).max(maxLength).nullable();

/**
 * The PATCH body for one resource type: its translatable keys, each capped
 * like its source. A product also takes its option names and values, keyed
 * `option:[…]` — which ones exist depends on the product, so the handler
 * checks them against its options.
 */
export function translationPatchSchema(resource: TranslatableResource) {
  const fields = TRANSLATABLE[resource];
  const values = z.object(
    Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, translationValue(field.maxLength).optional()]),
    ),
  );
  return z.object({
    locale: z.enum(STORE_LOCALES),
    values: resource === "product" ? values.catchall(translationValue(OPTION_TEXT.maxLength)) : values.strict(),
  });
}

const TranslationViewSchema = z.object({
  resource: z.string(),
  id: z.string(),
  sourceLocale: z.enum(STORE_LOCALES),
  /**
   * The languages this resource can be translated into: every language the
   * store has added except the primary, published or not — so an editor
   * without access to store settings still knows what to offer.
   */
  targetLocales: z.array(z.object({ locale: z.enum(STORE_LOCALES), published: z.boolean() })),
  source: z.record(z.string(), z.string().nullable()),
  options: z.array(
    z.object({
      name: z.string(),
      key: z.string(),
      values: z.array(z.object({ value: z.string(), key: z.string() })),
    }),
  ),
  translations: z.partialRecord(
    z.enum(STORE_LOCALES),
    z.record(z.string(), z.object({ value: z.string(), outdated: z.boolean() })),
  ),
});

export function registerTranslationRoutes(router: OpenAPIHono<AppContext>, options: TranslationRoutesOptions) {
  const { resource, path, label, tag } = options;
  const params = path.includes("{id}") ? z.object({ id: z.string() }) : undefined;
  const body = translationPatchSchema(resource);

  async function loadView(c: Context<AppContext>) {
    const db = getDb(c.env.DB);
    const id = c.req.param("id");
    const [record, store] = await Promise.all([options.load(db, id), getStore(db)]);
    if (!record) throw new NotFoundError(label, id);
    if (!store) throw new NotFoundError("Store");
    return { db, record, store };
  }

  async function respond(
    c: Context<AppContext>,
    db: AppDb,
    record: { id: string } & Record<string, unknown>,
    store: { id: string; lang: StoreLocale },
  ) {
    const [rows, localeRows] = await Promise.all([
      listResourceTranslations(db, resource, record.id),
      listStoreLocales(db, store.id),
    ]);
    const view = await translationView(resource, record, rows);
    const targetLocales = storeLanguages(store.lang, localeRows)
      .filter((language) => !language.primary)
      .map(({ locale, published }) => ({ locale, published }));
    return c.json(
      { success: true, data: { resource, id: record.id, sourceLocale: store.lang, targetLocales, ...view } },
      200,
    );
  }

  const getRoute = defineRoute({
    method: "get",
    path,
    auth: options.read,
    tags: [tag],
    summary: `Get a ${label.toLowerCase()}'s translations`,
    description:
      "The translatable fields in the store's primary language and every stored translation, each flagged `outdated` when its source text changed after it was written.",
    operationId: `get${label.replace(/\s/g, "")}Translations`,
    ...(params ? { params } : {}),
    responses: { 200: { description: "Source and translations", content: { "application/json": { schema: z.object({ success: z.boolean(), data: TranslationViewSchema }) } } } },
    handler: async (c) => {
      const { db, record, store } = await loadView(c);
      return respond(c, db, record, store);
    },
  });

  const patchRoute = defineRoute({
    method: "patch",
    path,
    auth: options.write,
    tags: [tag],
    summary: `Translate a ${label.toLowerCase()} into one language`,
    description:
      "A JSON Merge Patch (RFC 7396) of one language: a string sets a field, `null` removes its translation, other fields are untouched. The language must be one the store has added, and not its primary — the resource's own fields hold that.",
    operationId: `patch${label.replace(/\s/g, "")}Translations`,
    ...(params ? { params } : {}),
    body,
    responses: { 200: { description: "Source and translations after the patch", content: { "application/json": { schema: z.object({ success: z.boolean(), data: TranslationViewSchema }) } } } },
    handler: async (c) => {
      const { db, record, store } = await loadView(c);
      const { locale, values } = ((c.req as any).valid?.("json") ?? body.parse(await c.req.json())) as z.infer<typeof body>;
      const languages = storeLanguages(store.lang, await listStoreLocales(db, store.id));
      if (locale === store.lang) {
        throw new ValidationError(
          `${locale} is the store's primary language — edit the ${label.toLowerCase()} itself`,
          ERROR_CODES.VALIDATION_FAILED,
        );
      }
      if (!languages.some((language) => language.locale === locale)) {
        throw new ValidationError(`Add ${locale} to the store's languages before translating into it`, ERROR_CODES.VALIDATION_FAILED);
      }
      const sources = new Map(translatableSources(resource, record).map((field) => [field.key, field]));
      const set: { key: string; value: string; sourceDigest: string }[] = [];
      const remove: string[] = [];
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        const target = sources.get(key);
        if (!target && !(value === null && key.startsWith(OPTION_KEY_PREFIX))) {
          throw new ValidationError(`${key} is not a translatable field of this ${label.toLowerCase()}`, ERROR_CODES.VALIDATION_FAILED, { field: key });
        }
        if (value === null) {
          remove.push(key);
          continue;
        }
        const stored = target!.field.kind === "html" ? (await sanitizeRichText(value)).html : value;
        set.push({ key, value: stored, sourceDigest: await sourceDigest(target!.source) });
      }
      const options = parseVariantOptions(record.variantOptions);
      if (options.length > 0 && set.length + remove.length > 0) {
        const merged: Record<string, string> = {};
        for (const row of await listResourceTranslations(db, resource, record.id)) {
          if (row.locale === locale) merged[row.key] = row.value;
        }
        for (const key of remove) delete merged[key];
        for (const { key, value } of set) merged[key] = value;
        const [indistinct] = indistinctOptions(options, merged);
        if (indistinct !== undefined) {
          throw new ValidationError(
            indistinct === null
              ? "Two options would read the same in this language — give each its own name"
              : `Two values of "${indistinct}" would read the same in this language — give each its own text`,
            ERROR_CODES.VALIDATION_FAILED,
            { option: indistinct },
          );
        }
      }
      await writeTranslations(db, { resource, resourceId: record.id, locale }, { set, remove });
      return respond(c, db, record, store);
    },
  });

  router.openapi(getRoute.route, getRoute.handler);
  router.openapi(patchRoute.route, patchRoute.handler);
}
