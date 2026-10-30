/**
 * Store setup's one source of data: what every store starts with, and the
 * starter catalog a new, empty store opens with.
 *
 * - `storeDefaultsSql` — every store: the header and footer menus, the three
 *   default collections, the four legal pages, and — for a store that has
 *   never taken an order — a default shipping profile. Each is created only
 *   when the store lacks it; nothing the merchant has is touched.
 * - `demoCatalogSql` — a store with no products or categories of its own
 *   (`starterCatalogApplies`): `content.ts`'s catalog in the store's primary
 *   language, translated into the others, menu links to it and the default
 *   collections filled. Its pictures are the store's media at
 *   `starterImageKey(name)`, put there first by `storeStarterPictures`; one
 *   not ready yet is left out, and added by a later run.
 *
 * Every starter row's id begins with `starterPrefix(storeId)`, so the starter
 * can be told apart from the merchant's own data. Running either again
 * changes nothing, and a run cut short is completed by running it again with
 * the same `now`. Store setup runs both: `cod-server/scripts/seed-store.ts`
 * here, and a deployment from a platform release, which ships this SQL made
 * for its own schema (`starterTemplates`).
 */
import { DEFAULT_COLLECTIONS, defaultCollectionsSql } from "../catalog/collections";
import { STORE_LOCALES, type StoreLocale } from "../i18n/locales";
import { optionKey, sourceDigest } from "../i18n/translations";
import { legalPagesSql } from "../legal/seed";
import { escapeHtml } from "../legal/serialize";
import { defaultMenusSql } from "../navigation/default-menus";
import {
  STARTER_CATEGORIES,
  STARTER_COLLECTIONS,
  STARTER_COUPONS,
  STARTER_IMAGES,
  STARTER_MENU_LINKS,
  STARTER_OFFERS,
  STARTER_PRODUCTS,
  type Words,
} from "./content";
import type { MediaLibrary } from "../media/library";
import { defaultShippingSql } from "./shipping";

/** Moves when the starter's content changes; a deployment records the version it applied. */
export const STARTER_VERSION = 1;

/** The size of every starter picture, square. */
export const STARTER_IMAGE_SIZE = 1200;

export interface StarterStore {
  id: string;
  /** The store's name as the legal pages print it. */
  name: string;
  /** The name escaped for HTML; derived from `name` when absent. */
  nameHtml?: string;
  /** The store's primary language: rows are written in it and translated into every other. */
  lang: StoreLocale;
}

export const starterPrefix = (storeId: string) => `${storeId}:starter:`;
export const starterImageKey = (name: string) => `products/starter-${name}.webp`;
export { STARTER_IMAGES };

/**
 * Puts the starter pictures in the store's media, each read by its file name
 * (`starter-<name>.webp`), before `demoCatalogSql` shows them. A picture
 * already there is kept as it is.
 */
export async function storeStarterPictures(media: MediaLibrary, read: (fileName: string) => Promise<Uint8Array>): Promise<string[]> {
  const keys: string[] = [];
  for (const name of STARTER_IMAGES) {
    const body = await read(`starter-${name}.webp`);
    keys.push((await media.store({ key: starterImageKey(name), contentType: "image/webp", body, width: STARTER_IMAGE_SIZE, height: STARTER_IMAGE_SIZE })).key);
  }
  return keys;
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const num = (value: number | undefined) => (value === undefined ? "NULL" : String(value));

/**
 * A SQL condition, true while the store has no products and no categories
 * but the starter's own: when `demoCatalogSql` writes anything.
 */
export function starterCatalogApplies(storeId: string): string {
  const prefix = q(starterPrefix(storeId));
  const own = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE substr(id, 1, length(${prefix})) <> ${prefix})`;
  return `(${own("products")} AND ${own("product_categories")})`;
}

/** What every store starts with — each part only where the store lacks it. */
export async function storeDefaultsSql(store: StarterStore, now: string): Promise<string[]> {
  return [
    ...(await defaultMenusSql(store, now)),
    ...(await defaultCollectionsSql(store, now)),
    ...legalPagesSql(store, now),
    ...defaultShippingSql(store, now),
  ];
}

/**
 * The starter catalog, written only into a store with no products and no
 * categories but the starter's own, and never twice (`INSERT OR IGNORE` on
 * fixed ids). Translations go to every language but the primary one, so a
 * language the merchant adds later finds the catalog already in it.
 */
export async function demoCatalogSql(store: StarterStore, now: string): Promise<string[]> {
  const lang = store.lang;
  const prefix = starterPrefix(store.id);
  const id = (...parts: string[]) => `${prefix}${parts.join(":")}`;
  const others = STORE_LOCALES.filter((locale) => locale !== lang);
  const empty = starterCatalogApplies(store.id);
  const insert = (table: string, columns: Record<string, string>, also = "") =>
    `INSERT OR IGNORE INTO ${table} (${Object.keys(columns).join(", ")}) SELECT ${Object.values(columns).join(", ")} WHERE ${empty}${also ? ` AND ${also}` : ""}`;
  const translate = async (resource: string, resourceId: string, key: string, words: Words, also = "") => {
    const digest = await sourceDigest(words[lang]);
    return others.map((locale) =>
      insert("translations", { resource_type: q(resource), resource_id: q(resourceId), locale: q(locale), key: q(key), value: q(words[locale]), source_digest: q(digest), updated_at: q(now) }, also),
    );
  };
  const ready = (name: string) => `EXISTS (SELECT 1 FROM media WHERE key = ${q(starterImageKey(name))} AND status = 'ready')`;
  const statements: string[] = [];

  for (const [index, category] of STARTER_CATEGORIES.entries()) {
    const categoryId = id("category", category.key);
    statements.push(
      insert("product_categories", {
        id: q(categoryId),
        name: q(category.name[lang]),
        slug: q(category.slug),
        description: q(category.description[lang]),
        position: String(index + 1),
        created_at: q(now),
        updated_at: q(now),
      }),
      `UPDATE product_categories SET image_key = ${q(starterImageKey(category.image))} WHERE id = ${q(categoryId)} AND image_key IS NULL AND updated_at = created_at AND ${ready(category.image)} AND ${empty}`,
      ...(await translate("category", categoryId, "name", category.name)),
      ...(await translate("category", categoryId, "description", category.description)),
    );
  }

  for (const product of STARTER_PRODUCTS) {
    const productId = id("product", product.key);
    const sku = `STARTER-${product.handle.toUpperCase()}`;
    const option = product.option;
    const variantOptions = option ? JSON.stringify([{ name: option.name[lang], values: option.variants.map((variant) => ({ value: variant.value[lang] })) }]) : null;
    statements.push(
      insert("products", {
        id: q(productId),
        name: q(product.name[lang]),
        description: q(product.description[lang]),
        description_format: q("html"),
        handle: q(product.handle),
        currency: q("DZD"),
        price: String(product.price),
        compare_at_price: num(product.compareAtPrice),
        type: q("PHYSICAL"),
        has_variants: option ? "1" : "0",
        variant_options: variantOptions === null ? "NULL" : q(variantOptions),
        sku: option ? "NULL" : q(sku),
        inventory: String(product.inventory),
        track_inventory: "1",
        low_stock_threshold: "5",
        category_id: q(id("category", product.category)),
        tags: q(JSON.stringify(product.tags)),
        visibility: "1",
        status: q("ACTIVE"),
        show_in_store: "1",
        published_at: q(now),
        created_at: q(now),
        updated_at: q(now),
      }),
      insert(
        "product_images",
        {
          id: q(id("image", product.key)),
          product_id: q(productId),
          media_key: q(starterImageKey(product.image)),
          alt_text: q(product.name[lang]),
          width: String(STARTER_IMAGE_SIZE),
          height: String(STARTER_IMAGE_SIZE),
          type: "1",
          position: "1",
          created_at: q(now),
          updated_at: q(now),
        },
        ready(product.image),
      ),
      ...(await translate("product", productId, "name", product.name)),
      ...(await translate("product", productId, "description", product.description)),
    );
    if (!option) continue;
    statements.push(...(await translate("product", productId, optionKey(option.name[lang]), option.name)));
    for (const [index, variant] of option.variants.entries()) {
      statements.push(
        insert("product_variants", {
          id: q(id("variant", product.key, variant.key)),
          product_id: q(productId),
          variations: q(JSON.stringify({ [option.name[lang]]: variant.value[lang] })),
          currency: q("DZD"),
          price: String(variant.price),
          compare_at_price: num(variant.compareAtPrice),
          sku: q(`${sku}-${variant.key.toUpperCase()}`),
          inventory: String(variant.inventory),
          low_stock_threshold: "5",
          is_default: index === 0 ? "1" : "0",
          active: "1",
          position: String(index + 1),
          created_at: q(now),
          updated_at: q(now),
        }),
        ...(await translate("product", productId, optionKey(option.name[lang], variant.value[lang]), variant.value)),
      );
    }
  }

  for (const [handle, keys] of Object.entries(STARTER_COLLECTIONS)) {
    const collectionId = `${store.id}:collection:${handle}`;
    for (const [position, key] of keys.entries()) {
      statements.push(
        insert(
          "collection_products",
          { collection_id: q(collectionId), product_id: q(id("product", key)), position: String(position), added_at: q(now) },
          `EXISTS (SELECT 1 FROM collections WHERE id = ${q(collectionId)})`,
        ),
      );
    }
  }

  for (const offer of STARTER_OFFERS) {
    const offerId = id("offer", offer.key);
    const productId = id("product", offer.product);
    statements.push(
      insert("offers", {
        id: q(offerId),
        name: q(offer.name[lang]),
        trigger_product_id: q(productId),
        trigger_quantity: String(offer.triggerQuantity),
        reward_product_id: offer.kind === "free" ? q(productId) : "NULL",
        reward_quantity: String(offer.kind === "free" ? offer.rewardQuantity ?? 1 : 0),
        discount_type: q(offer.kind),
        status: q("active"),
        created_at: q(now),
        updated_at: q(now),
      }),
      ...(offer.tiers ?? []).map((tier) => insert("offer_price_tiers", { offer_id: q(offerId), quantity: String(tier.quantity), price: String(tier.price), free_shipping: tier.freeShipping ? "1" : "0" })),
      ...(await translate("offer", offerId, "name", offer.name)),
    );
  }

  for (const coupon of STARTER_COUPONS) {
    statements.push(
      insert("coupons", {
        id: q(id("coupon", coupon.key)),
        code: q(coupon.code),
        kind: q(coupon.kind),
        value: String(coupon.value),
        max_discount: num(coupon.maxDiscount),
        min_subtotal: num(coupon.minSubtotal),
        scope: q("store"),
        audience: q("everyone"),
        once_per_customer: "0",
        status: q("active"),
        created_at: q(now),
        updated_at: q(now),
      }),
    );
  }

  for (const [handle, links] of Object.entries(STARTER_MENU_LINKS)) {
    const menuId = `${store.id}:menu:${handle}`;
    for (const link of links) {
      const key = link.type === "category" ? link.category : link.collection;
      const itemId = id("menu", handle, key);
      const words = link.type === "category" ? STARTER_CATEGORIES.find((category) => category.key === key)!.name : DEFAULT_COLLECTIONS.find((collection) => collection.handle === key)!.title;
      const destination = link.type === "category" ? id("category", key) : `${store.id}:collection:${key}`;
      statements.push(
        insert(
          "store_menu_items",
          {
            id: q(itemId),
            menu_id: q(menuId),
            position: `(SELECT COALESCE(MAX(position) + 1, 0) FROM store_menu_items WHERE menu_id = ${q(menuId)} AND parent_id IS NULL)`,
            label: q(words[lang]),
            destination_type: q(link.type),
            destination_ref: q(destination),
            created_at: q(now),
            updated_at: q(now),
          },
          `EXISTS (SELECT 1 FROM store_menus WHERE id = ${q(menuId)})`,
        ),
        ...(await translate("menuItem", itemId, "label", words, `EXISTS (SELECT 1 FROM store_menu_items WHERE id = ${q(itemId)})`)),
      );
    }
  }

  return statements;
}

/**
 * Stand-ins for a store's own values in SQL made ahead of time — what a
 * platform release ships, so a deployment sets a store up with the SQL of
 * that release's own schema. Each stands inside an SQL string, so a value
 * replaces it escaped as one (`fillStarterTemplate`).
 */
export const STARTER_PLACEHOLDERS = {
  storeId: "{{store.id}}",
  storeName: "{{store.name}}",
  storeNameHtml: "{{store.nameHtml}}",
  now: "{{now}}",
} as const;

export interface StarterTemplate {
  /** `storeDefaultsSql`. */
  defaults: string[];
  /** `demoCatalogSql`. */
  catalog: string[];
}

/** The starter's SQL for a store of each primary language, with `STARTER_PLACEHOLDERS` for its values. */
export async function starterTemplates(): Promise<{ applies: string; languages: Record<StoreLocale, StarterTemplate> }> {
  const P = STARTER_PLACEHOLDERS;
  const languages = {} as Record<StoreLocale, StarterTemplate>;
  for (const lang of STORE_LOCALES) {
    const store: StarterStore = { id: P.storeId, name: P.storeName, nameHtml: P.storeNameHtml, lang };
    languages[lang] = { defaults: await storeDefaultsSql(store, P.now), catalog: await demoCatalogSql(store, P.now) };
  }
  return { applies: `SELECT ${starterCatalogApplies(P.storeId)} AS applies`, languages };
}

/** A template's statements for one store: each placeholder replaced, in one pass, by its value escaped for an SQL string. */
export function fillStarterTemplate(statements: readonly string[], values: { storeId: string; storeName: string; now: string }): string[] {
  const byToken = new Map<string, string>([
    [STARTER_PLACEHOLDERS.storeId, values.storeId],
    [STARTER_PLACEHOLDERS.storeName, values.storeName],
    [STARTER_PLACEHOLDERS.storeNameHtml, escapeHtml(values.storeName)],
    [STARTER_PLACEHOLDERS.now, values.now],
  ]);
  const token = new RegExp([...byToken.keys()].map((key) => key.replace(/[.{}]/g, "\\$&")).join("|"), "g");
  return statements.map((statement) => statement.replace(token, (found) => byToken.get(found)!.replace(/'/g, "''")));
}
