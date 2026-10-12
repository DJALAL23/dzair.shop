/**
 * The S8 bindings: `src/actions/index.ts` and `src/middleware.ts`.
 *
 * The engines — the input whitelist, the basket-or-product rule, attribution
 * forwarding, the PRG decision — live in @codflow/storefront/astro and are
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

vi.mock("@/theme/sdk", () => ({
  getStoreClient: () => ({ orders: { create: createOrder } }),
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

// The store context lives in `@/theme/runtime/store`; the middleware contract
// under test is the PRG wiring + where `locals.store` comes from (Theme Zero
// S2). Mock with a sentinel so both are observable.
const storeContext = {
  config: { name: "test-store" },
  content: { heroTitle: "test-title" },
  isRTL: false,
};

// A store whose primary is Arabic and which also publishes French: `/fr/…`
// renders the unprefixed route, `/ar/…` is the primary's second address.
vi.mock("@/theme/runtime/store", async (importOriginal) => ({
  languageSource: ((await importOriginal()) as typeof import("@/theme/runtime/store")).languageSource,
  resolveStoreRequest: async (path: string) =>
    /^\/ar(?:\/|$)/.test(path)
      ? { kind: "redirect", location: path.slice(3) || "/", status: 301 }
      : { kind: "page", store: { ...storeContext, pathname: path.replace(/^\/fr(?=\/|$)/, "") || "/" } },
}));

const { server } = await import("@/actions/index");
const { onRequest } = await import("@/middleware");
const { placeOrderInput } = await import("@codflow/storefront/astro");

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

describe("placeOrder binding (src/actions/index.ts)", () => {
  beforeEach(() => {
    createOrder.mockReset();
    getActionContext.mockReset();
  });

  it("registers placeOrder as a form action — the name and acceptance the forms post to", () => {
    expect(Object.keys(server)).toEqual(["placeOrder"]);
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

  it("passes cod-server's refusal through as a plain Error carrying its message", async () => {
    createOrder.mockResolvedValueOnce({ success: false, error: "المنتج غير متوفر" });

    await expect(
      action.handler(parsedSingleProductOrder, { request: orderRequest() }),
    ).rejects.toThrow("المنتج غير متوفر");
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
  next: (rewrite?: URL) => Promise<Response>,
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

const next = (rewrite?: URL) =>
  Promise.resolve(new Response(rewrite ? `page ${rewrite.pathname}${rewrite.search}` : "page"));

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

  it("lets a plain page request through to next() without storing a result", async () => {
    const setActionResult = wireAction(undefined);

    const response = await middleware(makeContext(pageRequest()), next);

    expect(await response.text()).toBe("page");
    expect(setActionResult).not.toHaveBeenCalled();
  });

  it("stores the framework's token as-is and 303-redirects an errored form post to the Referer", async () => {
    const setActionResult = wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST", message: "الاسم مطلوب" } }),
    });
    const request = pageRequest({ Referer: "http://shop.example/product/blue-t-shirt" });

    const response = await middleware(makeContext(request), next);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://shop.example/product/blue-t-shirt",
    );
    // Astro 7 hands over an OBJECT token — the binding must not stringify or copy it.
    expect(setActionResult).toHaveBeenCalledWith("placeOrder", {
      serialized: { error: { code: "BAD_REQUEST", message: "الاسم مطلوب" } },
    });
  });

  it("falls back to the posted path when the browser sent no Referer", async () => {
    wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST" } }),
    });

    const response = await middleware(makeContext(pageRequest()), next);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/checkout");
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
    expect(context.locals.store).toMatchObject({ ...storeContext, pathname: "/checkout" });
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

  it("returns a failed French form post to the French page", async () => {
    wireAction({
      calledFrom: "form",
      name: "placeOrder",
      handler: async () => ({ error: { code: "BAD_REQUEST" } }),
    });

    const response = await middleware(
      makeContext(new Request("http://shop.example/fr/checkout", { method: "POST" })),
      next,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/fr/checkout");
  });

  it("skips the store-context read for /api/* — those endpoints never render the shell", async () => {
    wireAction(undefined);
    const context = makeContext(new Request("http://shop.example/api/communes/16"));

    await middleware(context, next);

    expect(context.locals).toEqual({});
  });
});
