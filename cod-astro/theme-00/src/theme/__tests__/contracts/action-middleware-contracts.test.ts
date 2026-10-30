/**
 * The S8 bindings: `src/actions/index.ts` and `src/middleware.ts`.
 *
 * The engines — the input whitelist, the basket-or-product rule, attribution
 * forwarding, the PRG decision — live in @wocart/storefront/astro and are
 * tested there. What is left here is framework wiring, and that is what these
 * tests pin: the action name the form posts to, the form acceptance, that the
 * whitelist is the SDK's own object (no local copy can drift), how an engine
 * failure becomes an ActionError or an Error, that OTP/Turnstile proofs ride
 * along, and that the middleware stores whatever token `astro:actions` hands
 * it — an object on Astro 7, not a string.
 *
 * `astro:actions` and `astro:middleware` are virtual modules that only exist
 * inside an Astro project, so they are mocked with the real signatures.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const createOrder = vi.fn();
const getActionContext = vi.fn();
const readThemePreview = vi.fn();
const resolvePreviewStore = vi.fn();

/**
 * The store as the server answers it: Arabic first, French published too. The
 * request's language and redirects are then resolved for real, by the theme's
 * runtime and the SDK — only the network is faked.
 */
const storeConfig = (locale?: string) => ({
  name: "test-store",
  lang: "ar",
  locale: locale ?? "ar",
  locales: [
    { code: "ar", nativeName: "العربية", direction: "rtl" },
    { code: "fr", nativeName: "Français", direction: "ltr" },
  ],
  contentOverrides: {},
});

vi.mock("@/theme/sdk", () => ({
  getStoreClient: (locale?: string) => ({ orders: { create: createOrder }, config: { get: async () => storeConfig(locale) } }),
  readThemePreview: (request: Request) => readThemePreview(request),
  storeServerUrl: () => "http://localhost:8787",
  REVALIDATE_PATH: "/wocart-revalidate",
}));

vi.mock("astro:actions", () => ({
  defineAction: (config: unknown) => config,
  ActionError: class ActionError extends Error {
    code: string;
    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.code = code;
    }
  },
  getActionContext: (...args: unknown[]) => getActionContext(...args),
}));

vi.mock("astro:middleware", () => ({ defineMiddleware: (fn: unknown) => fn }));

// The preview's store context is mocked with a sentinel, so where
// `locals.store` comes from is observable on that route.
const storeContext = {
  config: { name: "test-store" },
  content: { heroTitle: "test-title" },
  isRTL: false,
};

vi.mock("@/theme/runtime/store", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolvePreviewStore: (draft: unknown) => resolvePreviewStore(draft),
}));

const { server } = await import("@/actions/index");
const { onRequest } = await import("@/middleware");
const { placeOrderInput } = await import("@wocart/storefront/astro");

interface ActionBinding {
  accept: string;
  input: unknown;
  handler: (
    input: Record<string, unknown>,
    context: { request: Request },
  ) => Promise<unknown>;
}

const action = server.placeOrder as unknown as ActionBinding;

const parsedSingleProductOrder = {
  productId: "prod_1",
  productName: "Galaxy A54",
  pricePerUnit: 2500,
  quantity: 1,
  customerName: "Ahmed Benali",
  phone: "0551234567",
  wilayaId: 16,
  communeId: "c-16-001",
  deliveryType: "home",
  otpToken: "otp-proof-token-123",
  turnstileToken: "turnstile-proof-token",
};

const orderRequest = (headers: Record<string, string> = {}) =>
  new Request("http://shop.example/checkout", { method: "POST", headers });

/** A server refusal as the SDK reports it: always with its domain error. */
const refusal = (code: string) => ({ category: "business", code, message: code, retryable: false, operation: "orders.create", sideEffect: "rejected" });

describe("placeOrder binding (src/actions/index.ts)", () => {
  beforeEach(() => {
    createOrder.mockReset();
    getActionContext.mockReset();
  });

  it("registers placeOrder as a form action — the name and acceptance the forms post to", () => {
    expect(Object.keys(server)).toEqual(["placeOrder", "orderStatus"]);
    expect(action.accept).toBe("form");
  });

  it("uses the SDK's whitelist object itself — a local copy is what drifts", () => {
    expect(action.input).toBe(placeOrderInput);
  });

  it("turns a shape failure into a BAD_REQUEST field error and never calls cod-server", async () => {
    await expect(
      action.handler(
        { customerName: "Ahmed Benali", phone: "0551234567", wilayaId: 16, communeId: "c-16-001" },
        { request: orderRequest() },
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "An order needs either a basket or a product.",
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("turns cod-server's refusal into a 422 ActionError, so the page reads it as a refusal", async () => {
    createOrder.mockResolvedValueOnce({ success: false, error: "المنتج غير متوفر", domainError: refusal("INSUFFICIENT_STOCK") });

    await expect(
      action.handler(parsedSingleProductOrder, { request: orderRequest() }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT", message: "المنتج غير متوفر" });
  });

  it("answers an order refused for its code with the refusal, for the code box to show", async () => {
    createOrder.mockResolvedValueOnce({
      success: false,
      error: "This coupon does not apply to the order",
      domainError: refusal("COUPON_NOT_APPLICABLE"),
      reason: "below_minimum_quantity",
      shortBy: 1,
    });

    await expect(
      action.handler({ ...parsedSingleProductOrder, couponCode: "TROIS" }, { request: orderRequest() }),
    ).resolves.toEqual({ couponRefusal: { reason: "below_minimum_quantity", shortBy: 1 } });
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ couponCode: "TROIS" }), expect.anything());
  });

  it("submits the parsed order with its OTP and Turnstile proofs, forwarding attribution", async () => {
    createOrder.mockResolvedValueOnce({
      success: true,
      data: { orderNumber: "ORD-1", total: 7500 },
    });

    const request = orderRequest({
      "User-Agent": "Mozilla/5.0 smoke",
      "CF-Connecting-IP": "41.1.2.3",
      Referer: "http://shop.example/product/blue-t-shirt",
    });

    await expect(
      action.handler(parsedSingleProductOrder, { request }),
    ).resolves.toEqual({ orderNumber: "ORD-1", total: 7500 });

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "prod_1",
        otpToken: "otp-proof-token-123",
        turnstileToken: "turnstile-proof-token",
      }),
      {
        "User-Agent": "Mozilla/5.0 smoke",
        "X-Forwarded-For": "41.1.2.3",
        Referer: "http://shop.example/product/blue-t-shirt",
      },
    );
  });
});

type Middleware = (
  context: {
    request: Request;
    url: URL;
    redirect: (location: string, status: number) => Response;
  },
  next: (rewrite?: string) => Promise<Response>,
) => Promise<Response>;

const middleware = onRequest as unknown as Middleware;

const pageRequest = (headers: Record<string, string> = {}) =>
  new Request("http://shop.example/checkout", { method: "POST", headers });

const makeContext = (request: Request) => ({
  request,
  url: new URL(request.url),
  // Middleware assigns `locals.store` — the context object must carry `locals`.
  locals: {} as Record<string, unknown>,
  redirect: (location: string, status: number) =>
    new Response(null, { status, headers: { location } }),
});

const next = (rewrite?: string) => Promise.resolve(new Response(rewrite ? `page ${rewrite}` : "page"));

describe("onRequest binding (src/middleware.ts)", () => {
  beforeEach(() => {
    getActionContext.mockReset();
  });

  const wireAction = (
    action: { calledFrom: string; name: string; handler: () => Promise<unknown> } | undefined,
    serializeActionResult = (result: unknown) => ({ serialized: result }),
  ) => {
    const setActionResult = vi.fn();
    getActionContext.mockReturnValue({
      action,
      setActionResult,
      serializeActionResult,
    });
    return setActionResult;
  };

  it("passes a prerendered page straight through: it has no request store", async () => {
    const setActionResult = wireAction(undefined);
    const context = { ...makeContext(new Request("http://shop.example/wocart-theme.json")), isPrerendered: true };

    const response = await middleware(context, next);

    expect(await response.text()).toBe("page");
    expect(context.locals.store).toBeUndefined();
    expect(getActionContext).not.toHaveBeenCalled();
    expect(setActionResult).not.toHaveBeenCalled();
  });

  it("lets a plain page request through to next() without storing a result", async () => {
    const setActionResult = wireAction(undefined);

    const response = await middleware(makeContext(pageRequest()), next);

    expect(await response.text()).toBe("page");
    expect(setActionResult).not.toHaveBeenCalled();
  });

  it("renders an errored form post in place and stores the framework's token as-is", async () => {
    const setActionResult = wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST", message: "الاسم مطلوب" } }),
    });
    const request = pageRequest({ Referer: "http://shop.example/product/blue-t-shirt" });

    const response = await middleware(makeContext(request), next);

    // No redirect: a 303 carried no result, so the shopper saw no error.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("page");
    // Astro 7 hands over an OBJECT token — the binding must not stringify or copy it.
    expect(setActionResult).toHaveBeenCalledWith("placeOrder", {
      serialized: { error: { code: "BAD_REQUEST", message: "الاسم مطلوب" } },
    });
  });

  it("renders an errored post without a Referer in place as well", async () => {
    wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST" } }),
    });

    const response = await middleware(makeContext(pageRequest()), next);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("page");
  });

  it("on success stores the result and calls next() — a redirect here would drop it", async () => {
    const setActionResult = wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ data: { orderNumber: "ORD-1" } }),
    });

    const response = await middleware(makeContext(pageRequest()), next);

    expect(await response.text()).toBe("page");
    expect(setActionResult).toHaveBeenCalledWith("placeOrder", {
      serialized: { data: { orderNumber: "ORD-1" } },
    });
  });

  it("leaves RPC calls (/_actions/*, calledFrom json) to Astro's own endpoint", async () => {
    const setActionResult = wireAction({
      calledFrom: "json",
      name: "placeOrder",
      handler: async () => ({ data: { orderNumber: "ORD-1" } }),
    });

    const response = await middleware(makeContext(pageRequest()), next);

    expect(await response.text()).toBe("page");
    expect(setActionResult).not.toHaveBeenCalled();
  });

  it("puts the store context on locals for every page request (Theme Zero S2)", async () => {
    wireAction(undefined);
    const context = makeContext(pageRequest());

    await middleware(context, next);

    // The layout, the pages and the action handlers all read this one value;
    // a second acquisition point is what store-context.test.ts forbids.
    expect(context.locals.store).toMatchObject({ config: { name: "test-store" }, locale: "ar", isRTL: true, pathname: "/checkout" });
  });

  it("renders /fr/… as the unprefixed route, keeping its query", async () => {
    wireAction(undefined);
    const context = makeContext(new Request("http://shop.example/fr/products?page=2"));

    const response = await middleware(context, next);

    expect(await response.text()).toBe("page /products?page=2");
    expect(context.locals.store).toMatchObject({ pathname: "/products" });
  });

  it("sends the primary's prefixed address to its one URL, permanently", async () => {
    wireAction(undefined);

    const response = await middleware(makeContext(new Request("http://shop.example/ar/products?page=2")), next);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/products?page=2");
  });

  it("renders a server island in the language of the page that asked for it, without rewriting it", async () => {
    wireAction(undefined);
    const context = makeContext(
      new Request("http://shop.example/_server-islands/RelatedProducts?e=1", {
        headers: { Referer: "http://shop.example/fr/products/phone" },
      }),
    );

    const response = await middleware(context, next);

    expect(await response.text()).toBe("page");
    expect(context.locals.store).toMatchObject({ pathname: "/products/phone" });
  });

  it("never redirects a server island, even when its page's address would", async () => {
    wireAction(undefined);
    const context = makeContext(
      new Request("http://shop.example/_server-islands/ReviewsIsland", {
        headers: { Referer: "http://shop.example/ar/products/phone" },
      }),
    );

    const response = await middleware(context, next);

    expect(response.status).toBe(200);
    expect(context.locals.store).toMatchObject({ pathname: "/products/phone" });
  });

  it("renders a failed French form post in place, on the French page", async () => {
    wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST" } }),
    });

    const response = await middleware(
      makeContext(new Request("http://shop.example/fr/checkout", { method: "POST" })),
      next,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // Rendered by the French page's own route, the unprefixed checkout.
    expect(await response.text()).toBe("page /checkout");
  });

  it("serves an /api/* endpoint in the language of the page that called it, never redirecting or rewriting it", async () => {
    wireAction(undefined);
    const french = makeContext(
      new Request("http://shop.example/api/cart/validate", {
        method: "POST",
        headers: { Referer: "http://shop.example/fr/checkout" },
      }),
    );
    expect(await (await middleware(french, next)).text()).toBe("page");
    expect(french.locals.store).toMatchObject({ pathname: "/checkout" });

    const primaryPrefix = makeContext(
      new Request("http://shop.example/api/cart/validate", { headers: { Referer: "http://shop.example/ar/checkout" } }),
    );
    expect((await middleware(primaryPrefix, next)).status).toBe(200);
    expect(primaryPrefix.locals.store).toMatchObject({ pathname: "/checkout" });

    for (const referer of [undefined, "http://elsewhere.example/fr/checkout", "not a url"]) {
      const context = makeContext(
        new Request("http://shop.example/api/communes/16", { headers: referer ? { Referer: referer } : {} }),
      );
      await middleware(context, next);
      expect(context.locals.store).toMatchObject({ pathname: "/" });
    }
  });
});

describe("the preview route in the middleware (src/middleware.ts)", () => {
  const claims = { aud: "http://shop.example", theme: "theme-00", editor: "https://cloud.codflow.store", iat: 1, exp: 2 };
  const draft = { surface: "home", locale: "fr", content: { fr: { heroTitle: "Soldes" } } };

  beforeEach(() => {
    getActionContext.mockReset();
    readThemePreview.mockReset();
    resolvePreviewStore.mockReset();
  });

  it("answers a refused preview with its status, before any store or action", async () => {
    readThemePreview.mockResolvedValue({ ok: false, status: 403, reason: "the token is refused: expired" });
    const context = makeContext(new Request("http://shop.example/wocart-preview?token=x&surface=home"));

    const response = await middleware(context, next);

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(context.locals.store).toBeUndefined();
    expect(resolvePreviewStore).not.toHaveBeenCalled();
    expect(getActionContext).not.toHaveBeenCalled();
  });

  it("renders a verified preview with the draft's store context, and never runs a form action", async () => {
    const request = new Request("http://shop.example/wocart-preview", { method: "POST" });
    readThemePreview.mockResolvedValue({ ok: true, claims, draft, token: "signed" });
    resolvePreviewStore.mockResolvedValue({ ...storeContext, locale: "fr" });
    const context = makeContext(request);

    const response = await middleware(context, next);

    expect(readThemePreview).toHaveBeenCalledWith(request);
    expect(resolvePreviewStore).toHaveBeenCalledWith(draft);
    expect(await response.text()).toBe("page");
    expect(context.locals.store).toEqual({ ...storeContext, locale: "fr" });
    expect(context.locals.preview).toEqual({ claims, draft, token: "signed" });
    expect(getActionContext).not.toHaveBeenCalled();
  });

  it("lets the revalidation route through with no store, no preview and no form action", async () => {
    const context = makeContext(new Request("http://shop.example/wocart-revalidate", { method: "POST" }));
    const response = await middleware(context, next);
    expect(await response.text()).toBe("page");
    expect(context.locals.store).toBeUndefined();
    expect(readThemePreview).not.toHaveBeenCalled();
    expect(getActionContext).not.toHaveBeenCalled();
  });

  it("never reads a preview on any other route, nor under a language prefix", async () => {
    getActionContext.mockReturnValue({ action: undefined, setActionResult: vi.fn(), serializeActionResult: vi.fn() });
    for (const path of ["/", "/fr/wocart-preview", "/wocart-preview/x", "/products?wocart-preview"]) {
      const context = makeContext(new Request(`http://shop.example${path}`));
      await middleware(context, next);
      expect(context.locals.preview).toBeUndefined();
    }
    expect(readThemePreview).not.toHaveBeenCalled();
  });
});
