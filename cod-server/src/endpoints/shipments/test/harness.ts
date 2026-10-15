/**
 * The world the shipment e2e tests run in: the real orders and shipments
 * routers over a real D1, a staff user whose scopes each test sets, and a
 * store with one customer, one product and a carrier company per case.
 *
 * Each test file still mocks `@/db` itself (vitest hoists mocks per file)
 * and points it at the harness database.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import type { AppDb } from "@/db";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import type { TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import ordersRouter from "../../orders/routes";
import shipmentsRouter from "../routes";

export const T0 = "2026-10-14T08:00:00.000Z";

export function shipmentsApp(d1: TestD1, scopes: () => string[]) {
  const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("user", { id: "staff_1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes: scopes() } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  app.route("/api/shipments", shipmentsRouter);
  return app;
}

/** Clears the tables and seeds the store; returns a commune of wilaya 16. */
export async function seedStore(db: AppDb, ecotrack: { baseUrl: string; token: string }): Promise<string> {
  for (const table of [
    schema.shipmentEvents,
    schema.shipments,
    schema.companyApiLogs,
    schema.activityLogs,
    schema.stockMovements,
    schema.orderProducts,
    schema.orderStatusHistory,
    schema.orders,
    schema.productVariants,
    schema.products,
    schema.customers,
    schema.driverCompensations,
    schema.drivers,
    schema.carrierCommunes,
    schema.carrierWilayas,
    schema.deliveryCompanies,
  ]) {
    await db.delete(table);
  }
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  await db.insert(schema.products).values({
    id: "p1", name: "Robe", handle: "robe", price: 1500, sku: "ROBE", hasVariants: false, inventory: 100, trackInventory: false,
    lowStockThreshold: 2, status: "ACTIVE", visibility: true, showInStore: true, storeFeatured: false, createdAt: T0, updatedAt: T0,
  });
  const company = { nameAr: "-", active: true, createdAt: T0, updatedAt: T0 };
  const eco = { provider: "ecotrack" as const, apiEndpoint: ecotrack.baseUrl, apiToken: ecotrack.token };
  const companies: Array<typeof schema.deliveryCompanies.$inferInsert> = [
    { ...company, ...eco, id: "eco", name: "Packers", code: "packers_ecotrack", autoValidate: true },
    { ...company, ...eco, id: "eco-manual", name: "Packers (manual)", code: "manual_ecotrack", autoValidate: false },
    { ...company, ...eco, id: "eco-home-only", name: "Home only", code: "home_ecotrack", supportsStopDesk: false },
    { ...company, ...eco, id: "off", name: "Inactive", code: "off_ecotrack", active: false },
    { ...company, ...eco, id: "unconnected", name: "Unconnected", code: "new_ecotrack", apiToken: null },
    { ...company, id: "yal", name: "Yalidine", code: "yalidine", provider: "yalidine", apiToken: "yal-token", apiUserGuid: "yal-id" },
    { ...company, id: "zr", name: "ZR", code: "zr_express", provider: "zr_express", apiToken: "zr-key", apiUserGuid: "tenant" },
    { ...company, id: "noest", name: "NOEST", code: "noest", provider: "noest", apiToken: "noest-token", apiUserGuid: "noest-guid" },
  ];
  // D1 binds at most 100 variables per statement.
  for (const row of companies) await db.insert(schema.deliveryCompanies).values(row);
  return (await db.select({ id: schema.communes.id }).from(schema.communes).where(eq(schema.communes.wilayaId, 16)).get())!.id;
}

export interface OrderSeed {
  id: string;
  status?: "new" | "confirmed" | "preparing" | "ready" | "cancelled";
  price?: number;
  deliveryFee?: number;
  address?: string | null;
  deliveryType?: "home" | "stop_desk";
  stationCode?: string | null;
  lines?: string[];
  notes?: string | null;
  wilayaId?: number;
}

export async function seedOrder(db: AppDb, communeId: string, seed: OrderSeed) {
  await db.insert(schema.orders).values({
    id: seed.id,
    orderNumber: `ORD-${seed.id}`,
    customerId: "c1",
    customerName: "Karim Benali",
    phone: "0551234567",
    wilayaId: seed.wilayaId ?? 16,
    communeId,
    address: seed.address === undefined ? "12 Rue Didouche Mourad" : seed.address,
    deliveryType: seed.deliveryType ?? "home",
    stationCode: seed.stationCode ?? null,
    price: seed.price ?? 1500,
    deliveryFee: seed.deliveryFee ?? 400,
    notes: seed.notes ?? null,
    status: seed.status ?? "ready",
    createdAt: T0,
    updatedAt: T0,
  });
  for (const [i, name] of (seed.lines ?? ["Robe kabyle"]).entries()) {
    await db.insert(schema.orderProducts).values({ id: `${seed.id}-l${i}`, orderId: seed.id, productId: "p1", productName: name, quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T0 });
  }
}

export const jsonRequest = (app: OpenAPIHono<AppContext>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
