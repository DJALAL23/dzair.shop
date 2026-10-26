/**
 * Route-level integration tests for Stores OpenAPIHono router.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";
import storesRouter from "./routes";
import * as queries from "./queries";

const mockDb = {
  select: vi.fn(),
} as any;

vi.mock("@/db", () => ({
  getDb: vi.fn(() => mockDb),
}));
vi.mock("./queries");

const NOW = new Date().toISOString();

function storeRow(overrides: Record<string, any> = {}) {
  return {
    id: "store_1",
    name: "My Shop",
    domain: null,
    logoUrl: "https://cdn.example.com/logo.png",
    themeId: "theme-00",
    primaryColor: "#3b82f6",
    accentColor: "#f97316",
    bgColor: "#ffffff",
    fontFamily: "Cairo",
    lang: "ar" as const,
    currency: "DZD",
    currencySymbol: "دج",
    metaTitle: "My Shop — Best Products",
    metaDescription: "Find the best products at My Shop.",
    ogImage: "https://cdn.example.com/og.png",
    reviewsEnabled: true,
    cartEnabled: false,
    // Delivery pricing settings default to today's behaviour: no free-delivery
    // threshold, and a mixed basket pays the highest applicable rate.
    freeShippingThreshold: null,
    cartShippingMode: "highest" as const,
    status: "active" as const,
    storeApiKey: "sk_store_abc123",
    createdAt: NOW,
    updatedAt: NOW,
    // NULL = today's order form. Appended last, like the schema column itself,
    // because the mock db maps a full-table select positionally.
    checkoutFormJson: null,
    // The widget config sits after it, again last in schema order. NULL is
    // "no widget", which is what every store reads until it configures one.
    whatsappWidgetJson: null,
    reviewMaxPhotos: 3,
    reviewVoiceMaxSeconds: null,
    reviewAutoPublish: "text_only" as const,
    shippingLabelJson: null,
    ...overrides,
  };
}

describe("Stores routes (OpenAPIHono)", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb } as any;
      signIn(c, {
        id: "admin_user_001",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
        apiKey: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as any);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/stores", storesRouter);
    vi.clearAllMocks();
    vi.mocked(queries.listStoreLocales).mockResolvedValue([{ locale: "ar", published: true }]);
  });

  describe("GET /api/stores/me", () => {
    it("returns 200 with store configuration", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());

      const res = await app.request("/api/stores/me");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("My Shop");
      expect(body.data.themeId).toBe("theme-00");
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/me");

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body).toMatchObject({
        code: "STORE_NOT_FOUND",
        category: ERROR_CATEGORIES.BUSINESS_LOGIC,
      });
    });
  });

  describe("PATCH /api/stores/me", () => {
    it("updates store configuration successfully", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(
        storeRow({ name: "Updated Shop" })
      );

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Shop" }),
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.name).toBe("Updated Shop");
    });

    it("passes cartEnabled through the route's own validation into the query layer", async () => {
      // Regression: the PATCH route validates the request body against its own
      // `body` schema BEFORE the handler runs (OpenAPIHono). A schema here that
      // has drifted from validation.ts silently drops any field it does not
      // know — not a 400, just gone — so the save looks successful and does
      // nothing. This asserts the field reaches queries.updateStore, not just
      // that the response contains it.
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(storeRow({ cartEnabled: true }));

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartEnabled: true }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateStore).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ cartEnabled: true }),
        null,
      );
    });

    it("passes freeShippingThreshold and cartShippingMode through to the query layer", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(
        storeRow({ freeShippingThreshold: 5000, cartShippingMode: "default_profile" }),
      );

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeShippingThreshold: 5000, cartShippingMode: "default_profile" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateStore).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          freeShippingThreshold: 5000,
          cartShippingMode: "default_profile",
        }),
        null,
      );
    });

    it("passes domain through to the query layer", async () => {
      // Same class of bug, pre-existing: domain was writable per
      // validation.ts but absent from the route's own copy.
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(
        storeRow({ domain: "shop.example.com" }),
      );

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "shop.example.com" }),
      });

      expect(res.status).toBe(200);
      expect(queries.updateStore).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ domain: "shop.example.com" }),
        null,
      );
    });

    it("neither takes nor returns colors and a font: they are the theme's settings", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(storeRow());
      vi.mocked(queries.updateStore).mockResolvedValue(storeRow({ name: "Renamed" }));

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed", primaryColor: "#000000", fontFamily: "Tajawal" }),
      });

      expect(res.status).toBe(200);
      const update = vi.mocked(queries.updateStore).mock.calls.at(-1)![2] as Record<string, unknown>;
      expect(update).toMatchObject({ name: "Renamed" });
      for (const key of ["primaryColor", "accentColor", "bgColor", "fontFamily"]) {
        expect(update).not.toHaveProperty(key);
        expect((await res.clone().json() as { data: Record<string, unknown> }).data).not.toHaveProperty(key);
      }
    });

    it("returns 404 when no store exists", async () => {
      vi.mocked(queries.getStore).mockResolvedValue(undefined);

      const res = await app.request("/api/stores/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Whatever" }),
      });

      expect(res.status).toBe(404);
    });
  });
});
