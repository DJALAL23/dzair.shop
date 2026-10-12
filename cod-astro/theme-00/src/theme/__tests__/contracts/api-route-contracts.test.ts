// @vitest-environment node
/**
 * S7 — the /api surface's contracts, one test per route.
 *
 * Every route is now a thin binding over the SDK's `createProxyEndpoint`
 * factory; the SDK's own tests cover the factory mechanics. These tests pin
 * what the BROWSER callers depend on: status codes, response envelopes, the
 * diagnostic fields that ride through failures (code, windowSeconds,
 * attemptsRemaining, terminal), cross-origin behavior per route, and the
 * attribution headers the abandoned proxy forwards. Each route's URL and
 * method come from Astro's file-based routing — the files did not move.
 *
 * Deliberate pre-migration parity this file pins (see slices-plan S7):
 * /api/otp/send, /api/otp/verify and /api/submit-review had NO cross-origin
 * check before the migration, and they still do not; cart, abandoned and
 * abandoned/convert keep theirs.
 */
/// <reference types="vitest/globals" />

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    geo: { communes: vi.fn() },
    cart: { validate: vi.fn() },
    orders: {
      otp: { send: vi.fn(), verify: vi.fn() },
      abandoned: { upsert: vi.fn(), convert: vi.fn() },
    },
    products: { reviews: { list: vi.fn(), submit: vi.fn() } },
  },
}));

vi.mock("@/theme/sdk", () => ({ getStoreClient: () => mockStore }));

import { GET as communes } from "@/pages/api/communes/[wilayaId]";
import { POST as otpSend } from "@/pages/api/otp/send";
import { POST as otpVerify } from "@/pages/api/otp/verify";
import { POST as cartValidate } from "@/pages/api/cart/validate";
import { GET as productReviews } from "@/pages/api/product-reviews/[productId]";
import { POST as submitReview } from "@/pages/api/submit-review";
import { POST as abandonedUpsert } from "@/pages/api/abandoned/index";
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

function ctx(request: Request, params: Record<string, string> = {}) {
  return { request, params };
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
    expect(mockStore.orders.otp.send).toHaveBeenCalledWith("0551234567");
  });

  it("502s an upstream rejection and forwards the rate-limit diagnostics", async () => {
    mockStore.orders.otp.send.mockResolvedValue({
      success: false,
      error: "Too many requests",
      code: "OTP_RATE_LIMITED",
      windowSeconds: 42,
    });

    const res = await otpSend(ctx(post("/api/otp/send", { phone: "0551234567" })));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
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

  it("has no cross-origin check (pre-migration parity)", async () => {
    mockStore.orders.otp.send.mockResolvedValue({ success: true, data: sent });

    const res = await otpSend(
      ctx(post("/api/otp/send", { phone: "0551234567" }, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(200);
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
    expect(mockStore.orders.otp.verify).toHaveBeenCalledWith("0551234567", "req-1", "123456");
  });

  it("422s a wrong code and forwards attemptsRemaining/terminal", async () => {
    mockStore.orders.otp.verify.mockResolvedValue({
      success: false,
      error: "Wrong code",
      code: "OTP_INVALID",
      attemptsRemaining: 3,
      terminal: false,
    });

    const res = await otpVerify(
      ctx(post("/api/otp/verify", { phone: "0551234567", requestId: "req-1", code: "000000" })),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
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
    mockStore.cart.validate.mockResolvedValue({ success: true, data: validation });

    const res = await cartValidate(ctx(post("/api/cart/validate", { items })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: validation });
    expect(mockStore.cart.validate).toHaveBeenCalledWith(items);
  });

  it("rejects a cross-origin POST with 403 (CSRF kept)", async () => {
    const res = await cartValidate(
      ctx(post("/api/cart/validate", { items }, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-origin not allowed" });
    expect(mockStore.cart.validate).not.toHaveBeenCalled();
  });

  it("400s a schema-invalid basket without calling the SDK", async () => {
    const res = await cartValidate(ctx(post("/api/cart/validate", { items: [] })));
    expect(res.status).toBe(400);
    expect(mockStore.cart.validate).not.toHaveBeenCalled();
  });

  it("502s an upstream failure — the drawer keeps its optimistic view", async () => {
    mockStore.cart.validate.mockResolvedValue({ success: false, error: "Upstream down" });

    const res = await cartValidate(ctx(post("/api/cart/validate", { items })));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream down" });
  });
});

describe("/api/product-reviews/[productId]", () => {
  it("returns { data, total } and clamps limit to 50", async () => {
    mockStore.products.reviews.list.mockResolvedValue({
      rows: [{ id: "rev-1" }],
      total: 7,
    });

    const res = await productReviews(
      ctx(get("/api/product-reviews/prod-1?limit=500&offset=10"), { productId: "prod-1" }),
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
      ctx(get("/api/product-reviews/prod-1"), { productId: "prod-1" }),
    );

    expect(res.status).toBe(200);
    expect(mockStore.products.reviews.list).toHaveBeenCalledWith("prod-1", {
      limit: 20,
      offset: 0,
    });
  });
});

describe("/api/submit-review", () => {
  const body = {
    orderNumber: "ORD-1",
    productId: "prod-1",
    rating: 5,
    body: "Excellent service, livraison rapide.",
  };

  it("201s with the route's { success, data } envelope", async () => {
    mockStore.products.reviews.submit.mockResolvedValue({
      success: true,
      data: { id: "rev-1" },
    });

    const res = await submitReview(ctx(post("/api/submit-review", body)));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { id: "rev-1" } });
    expect(mockStore.products.reviews.submit).toHaveBeenCalledWith(body);
  });

  it("400s an upstream rejection with the server's message", async () => {
    mockStore.products.reviews.submit.mockResolvedValue({
      success: false,
      error: "Order not found",
    });

    const res = await submitReview(ctx(post("/api/submit-review", body)));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Order not found" });
  });

  it("has no cross-origin check (pre-migration parity)", async () => {
    mockStore.products.reviews.submit.mockResolvedValue({
      success: true,
      data: { id: "rev-2" },
    });

    const res = await submitReview(
      ctx(post("/api/submit-review", body, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(201);
  });
});

describe("/api/abandoned", () => {
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
        post("/api/abandoned", payload, {
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
      ctx(post("/api/abandoned", payload, { Origin: "https://evil.example" })),
    );

    expect(res.status).toBe(403);
    expect(mockStore.orders.abandoned.upsert).not.toHaveBeenCalled();
  });

  it("400s a payload without a valid name and phone", async () => {
    const res = await abandonedUpsert(
      ctx(post("/api/abandoned", { ...payload, customerName: "A" })),
    );

    expect(res.status).toBe(400);
    expect(mockStore.orders.abandoned.upsert).not.toHaveBeenCalled();
  });

  it("502s an upstream failure (the browser ignores the status either way)", async () => {
    mockStore.orders.abandoned.upsert.mockResolvedValue({
      success: false,
      error: "Upstream down",
    });

    const res = await abandonedUpsert(ctx(post("/api/abandoned", payload)));

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