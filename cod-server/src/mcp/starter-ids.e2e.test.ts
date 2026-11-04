/**
 * The MCP tools on the real starter catalog, on real D1: its rows carry ids
 * like `store-1:starter:product:handbag`, and every tool that takes one finds
 * the row, changes it, or removes it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_MEDIA_VARS, testMedia } from "@/test-utils/media";
import { webp } from "../../../cod-shared/media/hosts/testing/files";
import { demoCatalogSql, starterPrefix, storeDefaultsSql, storeStarterPictures, type StarterStore } from "../../../cod-shared/starter";
import { getProductTools } from "@/endpoints/products/ai-tools";
import { getVariantTools } from "@/endpoints/variants/ai-tools";
import { getOfferTools } from "@/endpoints/offers/ai-tools";
import { getCouponTools } from "@/endpoints/coupons/ai-tools";
import { getStockTools } from "@/endpoints/stock/ai-tools";
import type { McpProps } from "./props";

const NOW = "2026-11-04T08:00:00.000Z";
const STORE: StarterStore = { id: "store-1", name: "Boutique Amel", lang: "ar" };
const P = starterPrefix(STORE.id);
const PROPS: McpProps = { userId: "u1", role: "admin", scopes: [], name: "Nadia", email: "nadia@example.com" };

let d1: TestD1;

type Tools = Record<string, { execute?: unknown }>;
const call = async (tools: Tools, name: string, args: Record<string, unknown>) =>
  (tools[name]!.execute as (args: unknown, options: unknown) => Promise<any>)(args, { toolCallId: "t", messages: [] });

const one = async <T = Record<string, unknown>>(sql: string, ...binds: unknown[]) =>
  (await d1.raw.prepare(sql).bind(...binds).first<T>()) ?? undefined;

beforeAll(async () => {
  d1 = await createTestD1();
  await d1.raw.prepare("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(STORE.id, STORE.name, STORE.lang, NOW).run();
  await storeStarterPictures(testMedia(d1), async () => webp());
  const statements = [...(await storeDefaultsSql(STORE, NOW)), ...(await demoCatalogSql(STORE, NOW))];
  for (let i = 0; i < statements.length; i += 50) await d1.raw.batch(statements.slice(i, i + 50).map((s) => d1.raw.prepare(s)));
}, 120_000);

afterAll(async () => d1?.dispose());

const env = () => ({ DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS }) as never;

describe("MCP tools on the starter catalog", () => {
  it("seeds rows whose ids are not UUIDs", async () => {
    expect(await one("SELECT id FROM products WHERE id = ?1", `${P}product:handbag`)).toBeDefined();
  });

  it("reads a starter variant, an offer and a coupon by id", async () => {
    const variant = await one<{ id: string }>("SELECT id FROM product_variants WHERE id LIKE ?1 LIMIT 1", `${P}%`);
    expect((await call(getVariantTools(d1.db), "getVariantDetails", { variantId: variant!.id })).success).toBe(true);

    const offer = await one<{ id: string }>("SELECT id FROM offers WHERE id LIKE ?1 LIMIT 1", `${P}%`);
    expect((await call(getOfferTools(d1.db), "getOfferDetails", { offerId: offer!.id })).success).toBe(true);

    const coupon = await one<{ id: string }>("SELECT id FROM coupons WHERE id LIKE ?1 LIMIT 1", `${P}%`);
    expect((await call(getCouponTools(d1.db), "getCouponDetails", { couponId: coupon!.id })).success).toBe(true);
  });

  it("adjusts a starter variant's stock", async () => {
    const variant = await one<{ id: string; product_id: string; inventory: number }>(
      "SELECT id, product_id, inventory FROM product_variants WHERE id LIKE ?1 LIMIT 1",
      `${P}%`,
    );
    const result = await call(getStockTools(d1.db, PROPS), "adjustVariantStock", {
      productId: variant!.product_id,
      variantId: variant!.id,
      type: "ADJUSTMENT_ADD",
      delta: 3,
      reason: "Recount",
    });
    expect(result.success).toBe(true);
    expect((await one<{ inventory: number }>("SELECT inventory FROM product_variants WHERE id = ?1", variant!.id))!.inventory).toBe(variant!.inventory + 3);
  });

  it("deletes the starter handbag by its id", async () => {
    const result = await call(getProductTools(d1.db, env()), "deleteProduct", { productId: `${P}product:handbag` });
    expect(result.success).toBe(true);
    expect(await one("SELECT id FROM products WHERE id = ?1", `${P}product:handbag`)).toBeUndefined();
  });
});
