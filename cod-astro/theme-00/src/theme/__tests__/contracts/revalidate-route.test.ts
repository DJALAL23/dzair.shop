// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The revalidation route (`/wocart-revalidate`): a publish shows at once. The
 * route drops every cached page — the tag all cached page routes carry — only
 * for a token the platform made for revalidation, for this store and theme;
 * anything else drops nothing. Tokens are signed with real Ed25519 keys, and
 * the store checks them with its real SDK.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { PAGES_CACHE_TAG } from "@wocart/storefront/server";

const env = vi.hoisted(() => ({ WOCART_PREVIEW_KEY: undefined as string | undefined }));
vi.mock("astro:env/server", () => ({
  COD_SERVER_URL: "http://localhost:8787",
  STORE_API_KEY: "test-key",
  get WOCART_PREVIEW_KEY() {
    return env.WOCART_PREVIEW_KEY;
  },
}));

const route = await import("@/pages/wocart-revalidate");

const STORE = "https://boutique.dz";
let privateKey: CryptoKey;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
async function sign(payload: Record<string, unknown>) {
  const head = encodeJson({ alg: "EdDSA", typ: "JWT" });
  const body = encodeJson(payload);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(signature)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const revalidation = (over: Record<string, unknown> = {}) => ({ aud: STORE, theme: "theme-00", use: "revalidate", iat: now(), exp: now() + 120, ...over });

async function call(authorization?: string) {
  const invalidate = vi.fn(async () => {});
  const request = new Request(`${STORE}/wocart-revalidate`, { method: "POST", headers: authorization ? { Authorization: authorization } : {} });
  const response = await route.POST({ request, cache: { invalidate } } as unknown as APIContext);
  return { response, invalidate };
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  env.WOCART_PREVIEW_KEY = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
});

describe("the revalidation route", () => {
  it("drops every cached page for the platform's revalidation token", async () => {
    const { response, invalidate } = await call(`Bearer ${await sign(revalidation())}`);
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(invalidate).toHaveBeenCalledWith({ tags: [PAGES_CACHE_TAG] });
  });

  it("drops nothing for a preview pass, another store's or theme's token, or none", async () => {
    const tokens = [
      await sign({ aud: STORE, theme: "theme-00", editor: "https://cloud.codflow.store", iat: now(), exp: now() + 600 }),
      await sign(revalidation({ aud: "https://other.dz" })),
      await sign(revalidation({ theme: "aurora" })),
    ];
    for (const token of tokens) {
      const { response, invalidate } = await call(`Bearer ${token}`);
      expect(response.status).toBe(403);
      expect(invalidate).not.toHaveBeenCalled();
    }
    const { response, invalidate } = await call();
    expect(response.status).toBe(401);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is a 404 on a store deployed without the key", async () => {
    const key = env.WOCART_PREVIEW_KEY;
    env.WOCART_PREVIEW_KEY = undefined;
    const { response, invalidate } = await call(`Bearer ${await sign(revalidation())}`);
    env.WOCART_PREVIEW_KEY = key;
    expect(response.status).toBe(404);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is rendered on demand, never prerendered, and answers only POST", () => {
    expect(route.prerender).toBe(false);
    const other = route.ALL();
    expect(other.status).toBe(405);
    expect(other.headers.get("Allow")).toBe("POST");
  });
});

describe("the cache tag a publish drops", () => {
  it("is carried by every cached page route, so no page shows an old publish", () => {
    const config = readFileSync(resolve(__dirname, "../../../../astro.config.mjs"), "utf8");
    const rules = config.slice(config.indexOf("routeRules: {"), config.indexOf("},\n  env:"));
    const routes = [...rules.matchAll(/"([^"]+)":\s*\{[^}]*tags:\s*\[([^\]]*)\]/g)].map((match) => ({ route: match[1]!, tags: match[2]! }));
    expect(routes.length).toBeGreaterThan(5);
    const pages = routes.filter((rule) => !rule.route.startsWith("/api/"));
    expect(pages.filter((rule) => !rule.tags.includes("PAGES_CACHE_TAG")).map((rule) => rule.route)).toEqual([]);
    expect(rules).not.toContain('"pages"');
  });
});
