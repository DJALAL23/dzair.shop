import { describe, expect, it } from "vitest";
import { DEFAULT_COLLECTIONS } from "../catalog/collections";
import { couponProblem, normalizeCouponCode } from "../coupons/model";
import { STORE_LOCALES } from "../i18n/locales";
import { optionKey } from "../i18n/translations";
import { offerProblem } from "../offers/model";
import {
  STARTER_PLACEHOLDERS,
  demoCatalogSql,
  fillStarterTemplate,
  starterCatalogApplies,
  starterImageKey,
  starterPrefix,
  starterTemplates,
  storeDefaultsSql,
  type StarterStore,
} from "./index";
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
import { DEFAULT_SHIPPING_PROFILE, DEFAULT_SHIPPING_ZONES, defaultShippingSql } from "./shipping";

const NOW = "2026-10-20T08:00:00.000Z";
const STORE: StarterStore = { id: "store-1", name: "Boutique", lang: "ar" };

const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

function everyWords(): Array<[string, Words]> {
  return [
    ...STARTER_CATEGORIES.flatMap((c) => [[`category ${c.key} name`, c.name], [`category ${c.key} description`, c.description]] as Array<[string, Words]>),
    ...STARTER_PRODUCTS.flatMap((p) => [
      [`product ${p.key} name`, p.name] as [string, Words],
      [`product ${p.key} description`, p.description] as [string, Words],
      ...(p.option ? [[`product ${p.key} option`, p.option.name] as [string, Words], ...p.option.variants.map((v) => [`variant ${p.key}/${v.key}`, v.value] as [string, Words])] : []),
    ]),
    ...STARTER_OFFERS.map((o) => [`offer ${o.key}`, o.name] as [string, Words]),
    ["shipping profile name", DEFAULT_SHIPPING_PROFILE.name],
    ["shipping profile notes", DEFAULT_SHIPPING_PROFILE.notes],
  ];
}

describe("starter content", () => {
  it.each(everyWords())("%s is written in every language", (_where, words) => {
    for (const locale of STORE_LOCALES) expect(words[locale]?.trim(), locale).toBeTruthy();
    expect(Object.keys(words).sort()).toEqual([...STORE_LOCALES].sort());
  });

  it("names products, categories, handles and slugs once each", () => {
    expect(unique(STARTER_PRODUCTS.map((p) => p.key))).toBe(true);
    expect(unique(STARTER_PRODUCTS.map((p) => p.handle))).toBe(true);
    expect(unique(STARTER_CATEGORIES.map((c) => c.key))).toBe(true);
    expect(unique(STARTER_CATEGORIES.map((c) => c.slug))).toBe(true);
    for (const product of STARTER_PRODUCTS) expect(product.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("points only at what it defines", () => {
    const categories = new Set(STARTER_CATEGORIES.map((c) => c.key));
    const products = new Set(STARTER_PRODUCTS.map((p) => p.key));
    const images = new Set(STARTER_IMAGES);
    const collections = new Set(DEFAULT_COLLECTIONS.map((c) => c.handle));
    for (const product of STARTER_PRODUCTS) {
      expect(categories.has(product.category), product.key).toBe(true);
      expect(images.has(product.image), product.key).toBe(true);
    }
    for (const category of STARTER_CATEGORIES) expect(images.has(category.image), category.key).toBe(true);
    for (const [handle, keys] of Object.entries(STARTER_COLLECTIONS)) {
      expect(collections.has(handle), handle).toBe(true);
      expect(unique(keys), handle).toBe(true);
      for (const key of keys) expect(products.has(key), `${handle}/${key}`).toBe(true);
    }
    for (const offer of STARTER_OFFERS) expect(products.has(offer.product), offer.key).toBe(true);
    for (const links of Object.values(STARTER_MENU_LINKS)) {
      for (const link of links) {
        if (link.type === "category") expect(categories.has(link.category), link.category).toBe(true);
        else expect(collections.has(link.collection), link.collection).toBe(true);
      }
    }
    expect(new Set(STARTER_PRODUCTS.map((p) => p.image))).toEqual(images);
  });

  it("keeps a variant product's stock on its variants alone", () => {
    for (const product of STARTER_PRODUCTS) if (product.option) expect(product.inventory, product.key).toBe(0);
  });

  it("prices in whole dinars, a compare-at price above the price, stock on every sellable line", () => {
    const lines = STARTER_PRODUCTS.flatMap((p): Array<{ price: number; compareAtPrice?: number; inventory: number }> => (p.option ? [...p.option.variants] : [p]));
    for (const line of lines) {
      expect(Number.isInteger(line.price) && line.price > 0).toBe(true);
      if (line.compareAtPrice !== undefined) expect(line.compareAtPrice).toBeGreaterThan(line.price);
      expect(Number.isInteger(line.inventory) && line.inventory > 0).toBe(true);
    }
  });

  it("gives every variant of a product its own value and translation key in every language", () => {
    for (const product of STARTER_PRODUCTS.filter((p) => p.option)) {
      const variants = product.option!.variants;
      expect(unique(variants.map((v) => v.key)), product.key).toBe(true);
      for (const locale of STORE_LOCALES) {
        expect(unique(variants.map((v) => v.value[locale])), `${product.key} ${locale}`).toBe(true);
        expect(unique(variants.map((v) => optionKey(product.option!.name[locale], v.value[locale]))), `${product.key} ${locale}`).toBe(true);
      }
    }
  });

  it.each(STARTER_OFFERS.map((offer) => [offer.key, offer] as const))("offer %s is one the dashboard would save", (_key, offer) => {
    const free = offer.kind === "free";
    expect(
      offerProblem({
        discountType: offer.kind,
        triggerProductId: offer.product,
        triggerVariantId: null,
        triggerQuantity: offer.triggerQuantity,
        rewardProductId: free ? offer.product : null,
        rewardVariantId: null,
        rewardQuantity: free ? offer.rewardQuantity ?? 1 : 0,
        startsAt: null,
        endsAt: null,
        tiers: offer.tiers ?? [],
      }),
    ).toBeNull();
  });

  it.each(STARTER_COUPONS.map((coupon) => [coupon.code, coupon] as const))("coupon %s is one the dashboard would save", (code, coupon) => {
    expect(normalizeCouponCode(code)).toBe(code);
    expect(
      couponProblem({
        code: coupon.code,
        kind: coupon.kind,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount ?? null,
        minSubtotal: coupon.minSubtotal ?? null,
        minQuantity: null,
        scope: "store",
        productIds: [],
        collectionIds: [],
        audience: "everyone",
        customerIds: [],
        groupIds: [],
        usageLimit: null,
        oncePerCustomer: false,
        startsAt: null,
        endsAt: null,
      }),
    ).toBeNull();
  });
});

describe("default shipping", () => {
  it("prices each of the 58 wilayas in exactly one zone", () => {
    const wilayas = DEFAULT_SHIPPING_ZONES.flatMap((zone) => zone.wilayas);
    expect([...wilayas].sort((a, b) => a - b)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
  });

  it("charges more the further from Algiers, stop desk below home", () => {
    for (const [index, zone] of DEFAULT_SHIPPING_ZONES.entries()) {
      expect(zone.stopDesk).toBeLessThan(zone.home);
      if (index > 0) expect(zone.home).toBeGreaterThan(DEFAULT_SHIPPING_ZONES[index - 1]!.home);
    }
  });

  it("writes the profile in the store's primary language", () => {
    const [profile] = defaultShippingSql({ id: "s", lang: "fr" }, NOW);
    expect(profile).toContain(`'${DEFAULT_SHIPPING_PROFILE.name.fr}'`);
    expect(profile).not.toContain(DEFAULT_SHIPPING_PROFILE.name.ar);
  });
});

describe("demoCatalogSql", () => {

  it("writes its own columns in the primary language and translates into every other", async () => {
    for (const lang of STORE_LOCALES) {
      const sql = (await demoCatalogSql({ ...STORE, lang }, NOW)).join("\n");
      const handbag = STARTER_PRODUCTS.find((p) => p.key === "handbag")!;
      const productRow = sql.split("\n").find((line) => line.startsWith("INSERT OR IGNORE INTO products") && line.includes("'leather-handbag'"))!;
      expect(productRow).toContain(`'${handbag.name[lang].replace(/'/g, "''")}'`);
      const translated = sql.split("\n").filter((line) => line.includes("INTO translations") && line.includes("starter:product:handbag', ") && line.includes("'name'"));
      expect(translated.map((line) => line.match(/'(ar|fr|en)', 'name'/)![1]).sort()).toEqual(STORE_LOCALES.filter((l) => l !== lang).sort());
    }
  });

  it("gives every row it creates an id under the starter prefix", async () => {
    const sql = await demoCatalogSql(STORE, NOW);
    const prefix = starterPrefix(STORE.id);
    for (const statement of sql.filter((s) => /INTO (products|product_categories|product_variants|product_images|offers|coupons|store_menu_items) /.test(s))) {
      const firstValue = statement.match(/ SELECT '([^']*)'/)![1]!;
      expect(firstValue.startsWith(prefix), statement.slice(0, 120)).toBe(true);
    }
  });

  it("shows each picture by its key, only once the store's media holds it ready", async () => {
    const sql = await demoCatalogSql(STORE, NOW);
    const ready = (name: string) => `EXISTS (SELECT 1 FROM media WHERE key = '${starterImageKey(name)}' AND status = 'ready')`;
    for (const product of STARTER_PRODUCTS) {
      const image = sql.find((s) => s.startsWith("INSERT OR IGNORE INTO product_images") && s.includes(`'${starterImageKey(product.image)}'`) && s.includes(`:image:${product.key}'`))!;
      expect(image).toContain(`AND ${ready(product.image)}`);
    }
    for (const category of STARTER_CATEGORIES) {
      const update = sql.find((s) => s.startsWith("UPDATE product_categories") && s.includes(`:category:${category.key}'`))!;
      expect(update).toBe(
        `UPDATE product_categories SET image_key = '${starterImageKey(category.image)}' WHERE id = 'store-1:starter:category:${category.key}' AND image_key IS NULL AND updated_at = created_at AND ${ready(category.image)} AND ${starterCatalogApplies(STORE.id)}`,
      );
    }
    expect(sql.join("\n")).not.toMatch(/https?:|image_url|\bsrc\b|r2_key/);
  });

  it("guards every statement on a store without products or categories of its own", async () => {
    const applies = starterCatalogApplies(STORE.id);
    expect(applies).toBe(
      "(NOT EXISTS (SELECT 1 FROM products WHERE substr(id, 1, length('store-1:starter:')) <> 'store-1:starter:') AND NOT EXISTS (SELECT 1 FROM product_categories WHERE substr(id, 1, length('store-1:starter:')) <> 'store-1:starter:'))",
    );
    for (const statement of await demoCatalogSql(STORE, NOW)) expect(statement).toContain(statement.startsWith("UPDATE") ? ` AND ${applies}` : ` WHERE ${applies}`);
  });

  it("quotes a store id with an apostrophe", async () => {
    const sql = await storeDefaultsSql({ ...STORE, id: "it's", name: "Chez l'ami" }, NOW);
    expect(sql.join("\n")).toContain("'it''s:shipping:default'");
  });
});

describe("starter templates", () => {
  const STORES: StarterStore[] = [
    { id: "store-wocart", name: "wocart.shop", lang: "ar" },
    { id: "store-amel", name: `Chez l'ami "Amel" & Fils <DZ>`, lang: "fr" },
    { id: "store-x", name: `{{now}} {{store.id}} $& $1`, lang: "en" },
  ];

  it.each(STORES.map((store) => [store.name, store] as const))("fill to the very SQL made for %s", async (_name, store) => {
    const { applies, languages } = await starterTemplates();
    const values = { storeId: store.id, storeName: store.name, now: NOW };
    expect(fillStarterTemplate(languages[store.lang].defaults, values)).toEqual(await storeDefaultsSql(store, NOW));
    expect(fillStarterTemplate(languages[store.lang].catalog, values)).toEqual(await demoCatalogSql(store, NOW));
    expect(fillStarterTemplate([applies], values)).toEqual([`SELECT ${starterCatalogApplies(store.id)} AS applies`]);
  });

  it("leave no placeholder behind, and hold one where the store's values go", async () => {
    const { languages } = await starterTemplates();
    for (const lang of STORE_LOCALES) {
      const sql = [...languages[lang].defaults, ...languages[lang].catalog].join("\n");
      for (const token of Object.values(STARTER_PLACEHOLDERS)) expect(sql, `${lang} ${token}`).toContain(token);
      const filled = fillStarterTemplate([sql], { storeId: "s", storeName: "n", now: NOW })[0]!;
      expect(filled).not.toMatch(/\{\{[a-zA-Z.]+\}\}/);
    }
  });
});
