/**
 * S5 boundary guard — which side of the seam each file is on.
 *
 * "No API key appears in the client bundle" (PLAN/04 Phase 2 gate) is not a
 * fact any single unit test observes; it is a structural property of what
 * imports what. This guard pins the structure so it stays true after S5:
 *
 * 1. `@wocart/storefront/server` is imported by exactly one file —
 *    `src/theme/sdk.ts`, the documented adapter. A second importer is how the
 *    server/client split erodes, and a `createStoreClient` call reachable from
 *    client code is one bundle away from shipping the key.
 * 2. Browser scripts (`src/theme/scripts/**`) never import the adapter. They
 *    use browser-safe helpers from `@wocart/storefront` directly. Importing
 *    `@/theme/sdk` from script code drags `astro:env/server` into the client
 *    graph (Astro fails that build) and blurs the documented layer rule.
 *
 * The live bundle check (grep `dist/` for the key after `npm run build`) stays
 * part of the S5 evidence; this guard is what keeps the property provable
 * without a build.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { STOREFRONT_API_PATHS, STOREFRONT_PAGE_PATHS } from "@wocart/storefront";

import { type SourceFile, SRC_DIR, themeSourceFiles } from "./theme-source";

const files: SourceFile[] = themeSourceFiles();

describe("S5 boundary guard", () => {
  it("scans the whole source tree (a broken walk must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("only the adapter imports the SDK server entry", () => {
    const importers = files
      .filter((f) => f.content.includes("@wocart/storefront/server"))
      .map((f) => f.relPath)
      .sort();

    expect(importers).toEqual(["theme/sdk.ts"]);
  });

  it("browser scripts never import a server-only theme module", () => {
    const offenders = files
      .filter(
        (f) =>
          f.relPath.startsWith("theme/scripts/") &&
          (f.content.includes("@/theme/sdk") ||
            f.content.includes("@/theme/utils/images")),
      )
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });
});

/**
 * S10 (pulled forward) — the legacy core layer is deleted, not dormant.
 *
 * Deleting files is the easy part; these rules keep them deleted. A revert
 * that drops `src/core/` back in, a hand-rolled CDN URL, or a second image
 * binding fails here instead of silently shipping dead code.
 */
describe("legacy core removal", () => {
  it("the legacy core layer is gone", () => {
    expect(existsSync(join(SRC_DIR, "core"))).toBe(false);
  });

  it("nothing in the tree imports the deleted core", () => {
    const offenders = files
      .filter((f) => f.content.includes("@/core/"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("no source file builds a CDN image URL by hand", () => {
    const offenders = files
      .filter((f) => f.content.includes("cdn-cgi"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("the image service is bound in exactly one theme module, the one both builds use", () => {
    const binders = files
      .filter((f) => f.content.includes("mediaImageService("))
      .map((f) => f.relPath)
      .sort();

    expect(binders).toEqual(["theme/utils/image-service.ts"]);
    const config = readFileSync(join(process.cwd(), "astro.config.mjs"), "utf8");
    expect(config).toContain('service: { entrypoint: "./src/theme/utils/image-service.ts" }');
    expect(config).not.toContain("passthroughImageService");
  });

  it("the image helpers are bound in exactly one theme module", () => {
    const importers = files
      .filter((f) => /\b(mediaImageUrl|mediaImageSrcset|pictureOf)\b/.test(f.content) && !f.relPath.includes("__tests__"))
      .map((f) => f.relPath)
      .sort();

    expect(importers).toEqual(["theme/utils/images.ts"]);
  });

  it("the cart thumbnail is built by the bound helper, at the store's delivery", () => {
    const productDetail = files.find(
      (f) => f.relPath === "theme/components/product-page/ProductOrder.astro",
    );

    expect(productDetail?.content).toContain('from "@/theme/utils/images"');
    expect(productDetail?.content).toContain("thumbnailImage(cartImageSrc, config.media)");
  });
});

/**
 * S9 — browser policy lives in the SDK, not in the scripts.
 *
 * The scripts keep DOM binding, visual state, copy, animation, focus and a11y.
 * Everything the platform decides — basket persistence and the `items[]` wire
 * projection today, phone rules / OTP transitions / tracking eligibility as
 * their bindings land — is bound from `@wocart/storefront`. These rules make a
 * re-implementation fail here instead of silently drifting from the server.
 *
 * Each guard is written against what the binding does, not against the old
 * file: it must stay green for a correct binding of any shape, and go red the
 * moment the rule moves back into the theme.
 */
describe("browser policy bindings", () => {
  const scripts = files.filter((f) => f.relPath.startsWith("theme/scripts/"));

  it("scans the script layer (a broken walk must not pass vacuously)", () => {
    // 17 non-test files today; the floor only has to catch a walk that
    // silently returned nothing.
    expect(scripts.length).toBeGreaterThan(12);
  });

  it("no browser script opens the basket's storage itself", () => {
    const offenders = scripts
      .filter((f) => f.content.includes("localStorage."))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("the basket control module binds the SDK store, and only it", () => {
    const cart = scripts.find((f) => f.relPath === "theme/scripts/cart.ts");

    expect(cart?.content).toContain("createBasketStore(");
    expect(cart?.content).toContain("basketLineKey");
    // Hand-rolled persistence needs its own (de)serialization; the bound store
    // has the only one, and the wire projection comes from the SDK too.
    expect(cart?.content).not.toContain("JSON.parse");
    expect(cart?.content).not.toContain("JSON.stringify");
    expect(cart?.content).not.toContain("pricePerUnit");
  });

  it("the OTP step binds the SDK machine, not a second state machine", () => {
    const otp = scripts.find((f) => f.relPath === "theme/scripts/otp-step.ts");

    expect(otp?.content).toContain("createOtpMachine(");
    expect(otp?.content).toContain("createOtpTransport({");
    expect(otp?.content).toMatch(/mapOtpResponse(<[^>]+>)?\(/);
    // Cooldown ticking, in-flight guarding, attempt counting and terminal
    // expiry are the machine's transitions — a local timer or flag is how the
    // old implementation had them.
    expect(otp?.content).not.toContain("setInterval(");
    expect(otp?.content).not.toContain("inFlight");
  });

  it("the abandonment binding delegates capture policy to the SDK", () => {
    const abandonment = scripts.find(
      (f) => f.relPath === "theme/scripts/track-abandonment.ts",
    );

    expect(abandonment?.content).toContain("createBrowserAbandonedCheckoutTracker");
    // The page wiring — session storage, Meta cookies, keepalive POST, beacon — is the SDK's too.
    expect(abandonment?.content).not.toMatch(/sessionStorage|sendBeacon|document\.cookie|keepalive/);
    expect(abandonment?.content).toContain("tracker.schedule");
    expect(abandonment?.content).toContain("tracker.captureOnExit");
    expect(abandonment?.content).not.toContain("toLocalAlgerianMobile");
  });

  it("every script that checks a phone uses the SDK rule", () => {
    // `[567]` is the Algerian-mobile prefix class a hand-rolled validator needs;
    // `toLocalAlgerianMobile` is the only implementation allowed to hold it.
    const offenders = scripts
      .filter((f) => f.content.includes("[567]"))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("delivery rates are read by the SDK's reader, which accepts what its schema does", () => {
    const delivery = scripts.find((f) => f.relPath === "theme/scripts/delivery-fields.ts");

    expect(delivery?.content).toContain("readShippingRates(");
    expect(delivery?.content).not.toContain("as ShippingRates");
  });

  it("basket money goes through the SDK formatter", () => {
    const render = scripts.find((f) => f.relPath === "theme/scripts/cart-render.ts");

    expect(render?.content).toContain("formatCurrency");
    expect(render?.content).not.toContain("toLocaleString");
  });

  it("the direct checkout posts nothing itself — the native form owns it", () => {
    const product = scripts.find((f) => f.relPath === "theme/scripts/product.ts");

    // No network call in the product script at all: the order travels as the
    // form's native POST and cod-server prices it. The one browser call the
    // product page makes — the commune lookup — lives in the bound
    // delivery-fields module.
    expect(product?.content).not.toContain("fetch(");
    expect(product?.content).not.toContain("applyAction");
  });

  it("the order form's items are the SDK's projection, not a local body", () => {
    const checkout = scripts.find((f) => f.relPath === "theme/scripts/checkout.ts");

    expect(checkout?.content).toContain("toOrderItems");
    // `pricePerUnit`/`productName` are the legacy flat fields; the SDK's
    // projection owns their names now.
    expect(checkout?.content).not.toContain("pricePerUnit");
    expect(checkout?.content).not.toContain("productName");
  });
});

/**
 * S10 — platform rules the theme no longer owns.
 *
 * These rules used to live in `src/theme/utils/` as theme code: the product
 * cover→gallery fallback today, the WhatsApp prefill resolver (tokens,
 * tracking params, the 900-character cap), the pathname→widget-surface map and
 * the 58-wilaya commune table as their bindings land. Each is a CodFlow
 * platform answer every theme would otherwise re-implement, so each is bound
 * from `@wocart/storefront` and guarded here: a copy reappearing in the theme
 * fails instead of drifting.
 */
describe("S10 platform rule bindings", () => {
  it("the product image rule is defined only in the SDK", () => {
    // The definition (`function …`) is the thing to guard: a theme that calls
    // the SDK's rule is correct, a theme that owns one is the bug.
    const definers = files
      .filter((f) => f.content.includes("function productImageSource"))
      .map((f) => f.relPath)
      .sort();

    expect(definers).toEqual([]);
    expect(existsSync(join(SRC_DIR, "theme/utils/product-image.ts"))).toBe(false);
  });

  it("the cart thumbnail takes the rule from the SDK", () => {
    const productDetail = files.find(
      (f) => f.relPath === "theme/components/product-page/ProductOrder.astro",
    );

    expect(productDetail?.content).toContain('productImageSource } from "@wocart/storefront"');
  });

  it("the WhatsApp prefill rule is defined only in the SDK", () => {
    const definers = files
      .filter(
        (f) =>
          f.content.includes("function resolvePrefillText") ||
          f.content.includes("function buildWhatsAppHref") ||
          f.content.includes("function truncateAtWordBoundary") ||
          f.content.includes("function stripTrackingParams"),
      )
      .map((f) => f.relPath)
      .sort();

    expect(definers).toEqual([]);
    expect(existsSync(join(SRC_DIR, "theme/utils/whatsapp-prefill.ts"))).toBe(false);
  });

  it("no theme file substitutes prefill tokens by hand", () => {
    // The 900-character cap, the `{product}` fallback to the store name and the
    // encoded `text=` are the SDK's rule. The thank-you page carried its own
    // `{store}`/`{order}` replacement until S10b — a URL that skipped the cap
    // entirely — so the shapes that resolve a prefill token are refused. A
    // theme-internal template (`cart-render.ts`'s `{amount}` sentence) is not
    // this rule and stays legitimate.
    const shapes = ["store", "product", "url", "order"].flatMap((token) => [
      `.replace(/{${token}}`,
      `.replaceAll("{${token}}"`,
      `.replace(/\\{${token}\\}`,
    ]);

    const offenders = files
      .filter((f) => shapes.some((shape) => f.content.includes(shape)))
      .map((f) => f.relPath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("every WhatsApp link comes from the SDK, through the theme's one binding", () => {
    // `whatsAppContact` resolves the page's message and every text in its
    // language; a link built anywhere else skips the merchant's words, the
    // cap and the token rules.
    const binding = "theme/utils/whatsapp.ts";
    const of = (test: (content: string) => boolean) => files.filter((f) => test(f.content)).map((f) => f.relPath).sort();

    expect(of((content) => content.includes("whatsAppContact("))).toEqual([binding]);
    expect(of((content) => /wa\.me|api\.whatsapp\.com|\?text=/.test(content))).toEqual([]);
    expect(of((content) => content.includes("config.whatsapp") || content.includes(".whatsapp.href"))).toEqual([]);
    for (const relPath of of((content) => content.includes("storeWhatsApp("))) {
      if (relPath !== binding) expect(files.find((f) => f.relPath === relPath)?.content, relPath).toContain('from "@/theme/utils/whatsapp"');
    }
  });

  it("the widget surface gate is defined only in the SDK", () => {
    const definers = files
      .filter((f) => f.content.includes("function showsWidgetOn"))
      .map((f) => f.relPath)
      .sort();

    expect(definers).toEqual([]);
    expect(existsSync(join(SRC_DIR, "theme/utils/shows-widget-on.ts"))).toBe(false);
    // The script-layer re-export had no caller; the SDK is the binding now.
    expect(existsSync(join(SRC_DIR, "theme/scripts/shows-widget-on.ts"))).toBe(false);
  });

  it("the layout asks the SDK's gate, and its special case is a contract path", () => {
    const layout = files.find((f) => f.relPath === "theme/layouts/StoreLayout.astro");

    expect(layout?.content).toMatch(/import \{[^}]*\bshowsWidgetOn\b[^}]*\} from "@wocart\/storefront"/);

    // The floating widget is suppressed on the thank-you page (that page renders
    // its own inline WhatsApp button). Suppressing it on a path outside the
    // frozen contract is how a typo silently hides the widget somewhere.
    const suppressed = [
      ...(layout?.content.matchAll(/pathname !== "(\/[^"]*)"/g) ?? []),
    ].map((match) => match[1]);

    for (const path of suppressed) {
      expect(Object.values(STOREFRONT_PAGE_PATHS)).toContain(path);
    }
  });

  it("the commune dataset is defined only in the SDK", () => {
    const definers = files
      .filter(
        (f) =>
          f.content.includes("ALGERIA_COMMUNES") ||
          f.content.includes("function getCommunesByWilayaId"),
      )
      .map((f) => f.relPath)
      .sort();

    expect(definers).toEqual([]);
    expect(existsSync(join(SRC_DIR, "theme/data/algeria-communes.ts"))).toBe(false);
    // The whole `theme/data/` layer is gone, not just this file: reference data
    // is the SDK's (`WILAYAS` on the form, `communesForWilaya` in the block).
    expect(existsSync(join(SRC_DIR, "theme/data"))).toBe(false);

    const importers = files
      .filter((f) => f.content.includes("@/theme/data"))
      .map((f) => f.relPath)
      .sort();

    expect(importers).toEqual([]);
  });

  it("the delivery block takes its commune rows from the SDK, network only as fallback", () => {
    const delivery = files.find(
      (f) => f.relPath === "theme/scripts/delivery-fields.ts",
    );

    expect(delivery?.content).toContain("communesForWilaya(numericId)");
    expect(delivery?.content).toContain('from "@wocart/storefront"');
    // Talmine (c-01-024) has no Arabic spelling in the dataset: an RTL label
    // that drops this fallback shows an empty option.
    expect(delivery?.content).toContain("commune.nameAr || commune.name");
    // The zero-network list is the first path and the API is the second, which
    // is what makes the row source replaceable without touching either.
    expect(delivery?.content).toContain('storefrontApiPath("communes"');
  });
});

/**
 * The proxy inputs belong to the platform.
 *
 * Each route used to hand-copy the bounds cod-server enforces — the abandoned
 * body was ~30 lines mirroring `upsertSchema`, and it had already drifted on
 * `communeId` and the variant fields. Each route is now the SDK's own
 * (`createStorefrontRoutes`): its input bounds, its cross-origin check and the
 * headers it forwards are decided once, in the SDK. These rules pin that no
 * route grows a local contract back (what the browser reads is pinned by
 * `api-route-contracts.test.ts`).
 */
describe("proxy input contracts", () => {
  const apiRoutes = files.filter((f) => f.relPath.startsWith("pages/api/"));

  it("every /api route is the SDK's, bound in theme/api-routes.ts", () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(8);
    for (const file of apiRoutes) {
      expect(file.content, file.relPath).toMatch(
        /^import \{ routes \} from "@\/theme\/api-routes";\s+export const (GET|POST|PUT) = routes\.\w+;\s*$/,
      );
    }
  });

  it("mounts a route file at every SDK path the browser calls, none it does not, and no file writes a path of its own", () => {
    // The SDK's `:wilayaId` is Astro's `[wilayaId]`: each path names exactly one route file.
    const routeFiles = apiRoutes.map((file) => `/${file.relPath.replace(/^pages\//, "").replace(/\.ts$/, "")}`);
    const expected = Object.values(STOREFRONT_API_PATHS).map((path) => path.replace(/:(\w+)/g, "[$1]"));
    expect(expected.filter((path) => !routeFiles.includes(path))).toEqual([]);
    expect(routeFiles.filter((route) => !expected.includes(route))).toEqual([]);
    const code = (text: string) => text.split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join("\n");
    const ownPaths = files.filter((f) => !f.relPath.startsWith("pages/api/") && /["'`]\/api\/[a-z]/.test(code(f.content))).map((f) => f.relPath);
    expect(ownPaths).toEqual([]);
  });

  it("no route declares its own input contract", () => {
    for (const file of apiRoutes) {
      expect(file.content, file.relPath).not.toContain("zod");
      expect(file.content, file.relPath).not.toContain("createProxyEndpoint");
    }
  });
});
