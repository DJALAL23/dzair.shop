// @vitest-environment node
/**
 * The /api surface's contracts, one block per route.
 *
 * Every route is the SDK's (`createStorefrontRoutes`), bound to the request's
 * own client in `src/theme/api-routes.ts`; the SDK's tests cover the
 * mechanics. These tests pin what the BROWSER callers depend on: status codes,
 * response envelopes, the diagnostic fields that ride through failures (code,
 * windowSeconds, attemptsRemaining, terminal), the cross-origin check on every
 * POST, and the shopper's address forwarded where the server counts or
 * attributes per shopper (OTP limits, abandoned checkouts). A refusal answers
 * with the status the server's category implies; a failure the shopper cannot
 * fix is a 502. Each route's URL and method come from Astro's file-based
 * routing.
 */
/// <reference types="vitest/globals" />

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    geo: { communes: vi.fn() },
    cart: { validate: vi.fn(), quote: vi.fn() },
    orders: {
      otp: { send: vi.fn(), verify: vi.fn() },
      abandoned: { upsert: vi.fn(), convert: vi.fn() },
    },
    products: { reviews: { list: vi.fn(), submit: vi.fn() } },
  },
}));

import { GET as communes } from "@/pages/api/communes/[wilayaId]";
import { POST as otpSend } from "@/pages/api/otp/send";
import { POST as otpVerify } from "@/pages/api/otp/verify";
import { POST as cartValidate } from "@/pages/api/cart/validate";
import { GET as productReviews } from "@/pages/api/reviews/[productId]";
import { POST as submitReview } from "@/pages/api/reviews/submit";
import { POST as abandonedUpsert } from "@/pages/api/abandoned/upsert";
import { POST as abandonedConvert } from "@/pages/api/abandoned/convert";

const ORIGIN = "https://shop.example";
const SESSION_ID = "2f0f4f7e-3f1c-4f0e-9a4b-1f4f2b7f9c11";

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// The middleware gives every /api request its store context, in the language
// of the page that called it (see action-middleware-contracts).
function ctx(request: Request, params: Record<string, string> = {}) {
  return { request, params, locals: { store: { client: mockStore } } } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("/api/communes/[wilayaId]", () => {
  it("returns { data } from the SDK read, with the parsed wilaya id", async () => {
    const communes16 = [
      { id: "1601", name: "Alger Centre", nameAr: "الجزائر الوسطى" },
    ];
    mockStore.geo.communes.mockResolvedValue(communes16);

    const res = await communes(ctx(get("/api/communes/16"), { wilayaId: "16" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: communes16 });
    expect(mockStore.geo.communes).toHaveBeenCalledWith(16);
  });

  it("400s an out-of-range wilaya without calling the SDK", async () => {
    const res = await communes(ctx(get("/api/communes/99"), { wilayaId: "99" }));
    expect(res.status).toBe(400);
    expect(mockStore.geo.communes).not.toHaveBeenCalled();
  });

  it("400s a non-numeric wilaya", async () => {
    const res = await communes(ctx(get("/api/communes/abc"), { wilayaId: "abc" }));
    expect(res.status).toBe(400);
    expect(mockStore.geo.communes).not.toHaveBeenCalled();
  });
});

describe("/api/otp/send", () => {
  const sent = { status: "sent", requestId: "req-1", expiresAt: 1, maxAttempts: 5 };

  it("returns { data } on success", async () => {
    mockStore.orders.otp.send.mockResolvedValue({ success: true, data: sent });

    const res = await otpSend(ctx(post("/api/otp/send", { phone: "0551234567" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: sent });
    expect(mockStore.orders.otp.send).toHaveBeenCalledWith("0551234567", {});
  });

  it("forwards the shopper's address — the server's limits count each shopper", async () => {
    mockStore.orders.otp.send.mockResolvedValue({ success: true, data: sent });

    await otpSend(ctx(post("/api/otp/send", { phone: "0551234567" }, { "CF-Connecting-IP": "41.1.2.3" })));

    expect(mockStore.orders.otp.send).toHaveBeenCalledWith(
      "0551234567",
      expect.objectContaining({ "X-Forwarded-For": "41.1.2.3" }),
    );
  });

  it("429s a rate limit and forwards the wait", async () => {
    mockStore.orders.otp.send.mockResolvedValue({
      success: false,
      error: "Too many requests",
      code: "OTP_RATE_LIMITED",
      windowSeconds: 42,
      domainError: {
        category: "business",
        code: "OTP_RATE_LIMITED",
        message: "Too many requests",
        retryable: true,
        operation: "orders.otp.send",
        sideEffect: "rejected",
        retryAfterSeconds: 42,
      },
    });

    const res = await otpSend(ctx(post("/api/otp/send", { phone: "0551234567" })));

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: "Too many requests",
      code: "OTP_RATE_LIMITED",
      windowSeconds: 42,
    });
  });

  it("400s a missing phone without calling the SDK", async () => {
    const res = await otpSend(ctx(post("/api/otp/send", { phone: "" })));
    expect(res.status).toBe(400);
    expect(mockStore.orders.otp.send).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin POST with 403", async () => {
    const res = await otpSend(
      ctx(post("/api/otp/send", { phone: "0551234567" }, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(mockStore.orders.otp.send).not.toHaveBeenCalled();
  });
});

describe("/api/otp/verify", () => {
  const verified = { status: "verified", otpToken: "tok-123" };

  it("returns { data } with the token on success", async () => {
    mockStore.orders.otp.verify.mockResolvedValue({ success: true, data: verified });

    const res = await otpVerify(
      ctx(post("/api/otp/verify", { phone: "0551234567", requestId: "req-1", code: "123456" })),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: verified });
    expect(mockStore.orders.otp.verify).toHaveBeenCalledWith("0551234567", "req-1", "123456", {});
  });

  it("422s a wrong code and forwards attemptsRemaining/terminal", async () => {
    mockStore.orders.otp.verify.mockResolvedValue({
      success: false,
      error: "Wrong code",
      code: "OTP_INVALID",
      attemptsRemaining: 3,
      terminal: false,
      domainError: {
        category: "business",
        code: "OTP_INVALID",
        message: "Wrong code",
        retryable: false,
        operation: "orders.otp.verify",
        sideEffect: "rejected",
      },
    });

    const res = await otpVerify(
      ctx(post("/api/otp/verify", { phone: "0551234567", requestId: "req-1", code: "000000" })),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: "Wrong code",
      code: "OTP_INVALID",
      attemptsRemaining: 3,
      terminal: false,
    });
  });
});

describe("/api/cart/validate", () => {
  const items = [
    { productId: "prod-1", productName: "Smart Watch", quantity: 2, pricePerUnit: 2500 },
  ];
  const validation = { items: [], subtotal: 5000, total: 5500 };

  it("wraps the SDK result in the route's { success, data } envelope", async () => {
    mockStore.cart.quote.mockResolvedValue({ success: true, data: validation });

    const res = await cartValidate(ctx(post("/api/cart/validate", { items })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: validation });
    expect(mockStore.cart.quote).toHaveBeenCalledWith({ items }, {});
  });

  it("rejects a cross-origin POST with 403 (CSRF kept)", async () => {
    const res = await cartValidate(
      ctx(post("/api/cart/validate", { items }, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-origin not allowed" });
    expect(mockStore.cart.quote).not.toHaveBeenCalled();
  });

  it("quotes one product as its form posts it, with the destination", async () => {
    mockStore.cart.quote.mockResolvedValue({ success: true, data: { lines: [] } });
    const form = { productId: "prod-1", productName: "Watch", quantity: 2, variantSelections: [{ variantId: "v1" }] };

    const res = await cartValidate(
      ctx(post("/api/cart/validate", { ...form, destination: { wilayaId: 16, deliveryType: "home" } })),
    );

    expect(res.status).toBe(200);
    expect(mockStore.cart.quote).toHaveBeenCalledWith(form, { destination: { wilayaId: 16, deliveryType: "home" } });
  });

  it("400s a schema-invalid basket without calling the SDK", async () => {
    const res = await cartValidate(ctx(post("/api/cart/validate", { items: [] })));
    expect(res.status).toBe(400);
    expect(mockStore.cart.quote).not.toHaveBeenCalled();
  });

  it("502s an upstream failure — the drawer keeps its optimistic view", async () => {
    mockStore.cart.quote.mockResolvedValue({ success: false, error: "Upstream down" });

    const res = await cartValidate(ctx(post("/api/cart/validate", { items })));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream down" });
  });
});

describe("/api/reviews/[productId]", () => {
  it("returns { data, total } and clamps limit to 50", async () => {
    mockStore.products.reviews.list.mockResolvedValue({
      rows: [{ id: "rev-1" }],
      total: 7,
    });

    const res = await productReviews(
      ctx(get("/api/reviews/prod-1?limit=500&offset=10"), { productId: "prod-1" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: "rev-1" }], total: 7 });
    expect(mockStore.products.reviews.list).toHaveBeenCalledWith("prod-1", {
      limit: 50,
      offset: 10,
    });
  });

  it("defaults limit to 20 and offset to 0", async () => {
    mockStore.products.reviews.list.mockResolvedValue({ rows: [], total: 0 });

    const res = await productReviews(
      ctx(get("/api/reviews/prod-1"), { productId: "prod-1" }),
    );

    expect(res.status).toBe(200);
    expect(mockStore.products.reviews.list).toHaveBeenCalledWith("prod-1", {
      limit: 20,
      offset: 0,
    });
  });
});

describe("/api/reviews/submit", () => {
  const body = {
    orderNumber: "ORD-1",
    phone: "0551234567",
    productId: "prod-1",
    rating: 5,
    body: "Excellent service, livraison rapide.",
  };

  it("201s with the route's { success, data } envelope", async () => {
    mockStore.products.reviews.submit.mockResolvedValue({
      success: true,
      data: { id: "rev-1" },
    });

    const res = await submitReview(ctx(post("/api/reviews/submit", body)));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { id: "rev-1" } });
    expect(mockStore.products.reviews.submit).toHaveBeenCalledWith(body);
  });

  it("answers a refusal with the server's code — the form picks its copy by it", async () => {
    mockStore.products.reviews.submit.mockResolvedValue({
      success: false,
      error: "Order not found",
      code: "ORDER_NOT_FOUND",
      domainError: {
        category: "business",
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
        retryable: false,
        operation: "products.reviews.submit",
        sideEffect: "rejected",
      },
    });

    const res = await submitReview(ctx(post("/api/reviews/submit", body)));

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("rejects a cross-origin POST with 403", async () => {
    const res = await submitReview(
      ctx(post("/api/reviews/submit", body, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(mockStore.products.reviews.submit).not.toHaveBeenCalled();
  });
});

describe("/api/abandoned/upsert", () => {
  const payload = {
    sessionId: SESSION_ID,
    customerName: "Amina",
    phone: "0551234567",
  };

  it("204s a successful upsert and forwards shopper attribution headers", async () => {
    mockStore.orders.abandoned.upsert.mockResolvedValue({
      success: true,
      data: { id: "ab-1" },
    });

    const res = await abandonedUpsert(
      ctx(
        post("/api/abandoned/upsert", payload, {
          "User-Agent": "Mozilla/5.0",
          "CF-Connecting-IP": "1.2.3.4",
          Referer: "https://shop.example/checkout",
        }),
      ),
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mockStore.orders.abandoned.upsert).toHaveBeenCalledWith(payload, {
      "User-Agent": "Mozilla/5.0",
      "X-Forwarded-For": "1.2.3.4",
      Referer: "https://shop.example/checkout",
    });
  });

  it("rejects cross-origin tracking with 403", async () => {
    const res = await abandonedUpsert(
      ctx(post("/api/abandoned/upsert", payload, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(mockStore.orders.abandoned.upsert).not.toHaveBeenCalled();
  });

  it("400s a payload without a valid name and phone", async () => {
    const res = await abandonedUpsert(
      ctx(post("/api/abandoned/upsert", { ...payload, customerName: "A" })),
    );

    expect(res.status).toBe(400);
    expect(mockStore.orders.abandoned.upsert).not.toHaveBeenCalled();
  });

  it("502s an upstream failure (the browser ignores the status either way)", async () => {
    mockStore.orders.abandoned.upsert.mockResolvedValue({
      success: false,
      error: "Upstream down",
    });

    const res = await abandonedUpsert(ctx(post("/api/abandoned/upsert", payload)));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream down" });
  });
});

describe("/api/abandoned/convert", () => {
  const payload = { sessionId: SESSION_ID, orderId: "ord-1", orderNumber: "ORD-1" };

  it("204s a conversion and passes the identifiers through", async () => {
    mockStore.orders.abandoned.convert.mockResolvedValue({ success: true, data: null });

    const res = await abandonedConvert(ctx(post("/api/abandoned/convert", payload)));

    expect(res.status).toBe(204);
    expect(mockStore.orders.abandoned.convert).toHaveBeenCalledWith(
      SESSION_ID,
      "ord-1",
      "ORD-1",
    );
  });

  it("400s a malformed conversion (non-uuid session)", async () => {
    const res = await abandonedConvert(
      ctx(post("/api/abandoned/convert", { ...payload, sessionId: "nope" })),
    );

    expect(res.status).toBe(400);
    expect(mockStore.orders.abandoned.convert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin with 403", async () => {
    const res = await abandonedConvert(
      ctx(post("/api/abandoned/convert", payload, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(mockStore.orders.abandoned.convert).not.toHaveBeenCalled();
  });
});