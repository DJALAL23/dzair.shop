// @vitest-environment node
/**
 * S5 — the theme adapter seam (`src/theme/sdk.ts`).
 *
 * `@vitest-environment node` is required: the adapter reads `astro:env/server`,
 * which refuses to load under the suite's default happy-dom environment.
 * (Same rule as the `.astro` component tests — see vitest.config.ts.)
 *
 * This file guards the ONE place in the theme that creates an SDK client. If
 * these tests fail, the failure is about the browser/server split, the
 * env wiring, or the API-key rule — not about rendering. That is the point of
 * concentrating the client factory in one module (PLAN/04 Phase 2, gate:
 * "One page reads store config + product data through the adapter; no API key
 * appears in the client bundle").
 *
 * The fixture is one product entry captured from a live cod-server so the shape is
 * evidence, not a hand-written guess. `coverImage.position` is 0-based in live
 * data — that stays pinned here too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStorefrontError } from "@wocart/storefront/server";

const LIVE_PRODUCT = {
  id: "prod_smart_watch",
  name: "ساعة ذكية Smart Watch T900",
  description: "<p>ساعة ذكية بشاشة 1.9 بوصة وبطارية تدوم 7 أيام.</p>",
  descriptionFormat: "html",
  descriptionPlain: "ساعة ذكية بشاشة 1.9 بوصة وبطارية تدوم 7 أيام.",
  handle: "smart-watch-t900",
  currency: "DZD",
  price: 4500,
  compareAtPrice: 5900,
  type: "PHYSICAL",
  hasVariants: true,
  variantOptions: [{ name: "اللون", values: [{ value: "أسود", hexColor: "#111111" }, { value: "فضي", hexColor: "#cccccc" }] }],
  sku: null,
  inventory: 12,
  trackInventory: true,
  lowStockThreshold: 5,
  categoryId: "cat_electronics",
  tags: ["ساعات", "هدايا"],
  metaTitle: null,
  metaDescription: null,
  coverImage: {
    id: "img_watch_1",
    productId: "prod_smart_watch",
    key: "products/watch-1.jpg",
    url: "https://ik.imagekit.io/wocart/stores/store_01/products/watch-1.jpg",
    altText: "ساعة ذكية سوداء",
    width: 1200,
    height: 1200,
    position: 0,
    createdAt: "2026-08-03T10:01:00.000Z",
    updatedAt: "2026-08-03T10:01:00.000Z",
  },
  reviewStats: { avgRating: 4.5, reviewCount: 7 },
};

interface FetchCall {
  url: string;
  headers: Headers;
}

// The environment is the boundary under test, not a collaborator: Astro's env
// plugin resolves real values (`.dev.vars` / process.env) once when Vite starts,
// so per-test process.env stubbing never reaches `astro:env/server`. Mocking
// the platform module with live getters is the honest seam — the adapter still
// has to read, validate, and apply these values itself. Real env wiring is
// covered by the live gate run (dev server + .dev.vars) and `npm run validate`.
const env = vi.hoisted(() => ({
  COD_SERVER_URL: undefined as string | undefined,
  STORE_API_KEY: undefined as string | undefined,
}));

vi.mock("astro:env/server", () => ({
  get COD_SERVER_URL() {
    return env.COD_SERVER_URL;
  },
  get STORE_API_KEY() {
    return env.STORE_API_KEY;
  },
}));

function stubStoreServerCalls(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ data: [LIVE_PRODUCT] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

describe("theme adapter — getStoreClient()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    env.COD_SERVER_URL = undefined;
    env.STORE_API_KEY = undefined;
    vi.unstubAllGlobals();
  });

  it("reads products from the configured server with the store API key", async () => {
    env.COD_SERVER_URL = "https://api.example.test";
    env.STORE_API_KEY = "test-key-abc";
    const calls = stubStoreServerCalls();

    const { getStoreClient } = await import("@/theme/sdk");
    const products = await getStoreClient().products.list();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/store/products");
    expect(calls[0].headers.get("X-Store-API-Key")).toBe("test-key-abc");
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("prod_smart_watch");
    expect(products[0].handle).toBe("smart-watch-t900");
  });

  it("fails fast with an actionable error when STORE_API_KEY is missing", async () => {
    env.COD_SERVER_URL = "https://api.example.test";
    const calls = stubStoreServerCalls();

    const { getStoreClient } = await import("@/theme/sdk");

    let caught: unknown;
    try {
      getStoreClient();
    } catch (error) {
      caught = error;
    }

    expect(isStorefrontError(caught)).toBe(true);
    expect((caught as { domainError: { code: string; operation: string } }).domainError).toEqual(
      expect.objectContaining({
        code: "MISSING_CONFIGURATION",
        operation: "client.create",
      }),
    );
    // The legacy client sent the literal "undefined" as the header and the
    // storefront quietly served an empty store. Fail-fast must mean no
    // request is attempted at all.
    expect(calls).toHaveLength(0);
  });

  it("gives every request its own client, so a hung read never blocks another request", async () => {
    env.COD_SERVER_URL = "https://api.example.test";
    env.STORE_API_KEY = "test-key-abc";
    const { getStoreClient } = await import("@/theme/sdk");

    // The first request's read never settles, as when its shopper leaves mid-load.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));

    const first = getStoreClient();
    void first.products.list();
    const second = getStoreClient();
    expect(second).not.toBe(first);

    const answer = await Promise.race([
      second.products.list().then(() => "answered"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);
    expect(answer).toBe("answered");
    vi.unstubAllGlobals();
  });
});
