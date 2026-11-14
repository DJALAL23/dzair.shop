/**
 * Who can reach the store, on real D1: a member turned off is stopped at the
 * door with their key at once and let back in when turned on; an admin can
 * never turn off or demote their own account, and the store always keeps an
 * active admin, even when two admins act at the same moment; permissions are
 * only ones the platform defines, set all at once; and every member, whatever
 * their permissions, sees the store's name and logo and nothing more of it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs } from "@/test-utils/api";
import { TEST_MEDIA_VARS } from "@/test-utils/media";
import { authMiddleware } from "@/middleware/auth";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import * as schema from "@/db/schema";
import { getDb } from "@/db";
import { ALL_SCOPES, SCOPES } from "../../../../cod-shared/rbac/scopes";
import * as queries from "./queries";
import usersRouter from "./routes";
import storesRouter from "../stores/routes";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const ROUTERS: Record<string, OpenAPIHono<AppContext>> = { "/api/users": usersRouter, "/api/stores": storesRouter };
const OWNER = { id: "u-owner", name: "Bilal", email: "bilal@shop.dz", role: "admin", status: "active", scopes: ["*"] } as AuthUser;
const owner = () => apiAs(d1, OWNER, ROUTERS);

/** The API as a caller with this key reaches it: through the same sign-in check as the deployed app. */
function withKey(apiKey: string) {
  const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, ...TEST_MEDIA_VARS } as never;
    await next();
  });
  app.use("/api/*", authMiddleware);
  app.onError(errorHandler);
  for (const [path, router] of Object.entries(ROUTERS)) app.route(path, router);
  return async (path: string) => {
    const res = await app.request(path, { headers: { "X-API-Key": apiKey } });
    return { status: res.status, body: (await res.json()) as any };
  };
}

/** The binding, but the first change to a member waits for `meanwhile` — another admin's change landing in between. */
function beforeUsersUpdate(raw: D1Database, meanwhile: () => Promise<unknown>): D1Database {
  let pending = true;
  const statement = (target: D1PreparedStatement, held: boolean): D1PreparedStatement =>
    new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop, t);
        if (prop === "bind") return (...args: unknown[]) => statement(value.apply(t, args), held);
        if (held && pending && (prop === "all" || prop === "run" || prop === "first" || prop === "raw")) {
          return async (...args: unknown[]) => {
            pending = false;
            await meanwhile();
            return value.apply(t, args);
          };
        }
        return typeof value === "function" ? value.bind(t) : value;
      },
    });
  return new Proxy(raw, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (prop === "prepare") return (query: string) => statement(value.call(t, query), /^update\s+"users"/i.test(query));
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "activity_logs", "orders", "customers", "team_agents", "team_memberships", "store_team_config", "user_scopes", "accounts", "users", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.stores).values({ id: "store-1", name: "Boutique Amel", domain: "amel.shop", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.users).values([
    { id: "u-owner", name: "Bilal", email: "bilal@shop.dz", role: "admin", status: "active", apiKey: "cod_owner" },
    { id: "u-lina", name: "Lina", email: "lina@shop.dz", role: "staff", status: "active", apiKey: "cod_lina" },
    { id: "u-nour", name: "Nour", email: "nour@shop.dz", role: "staff", status: "active", apiKey: "cod_nour" },
  ]);
  await d1.db.insert(schema.userScopes).values({ id: "s-lina", userId: "u-lina", scope: SCOPES.ORDERS_READ, grantedBy: "u-owner", grantedAt: T });
});

const statusOf = async (id: string) => (await d1.db.select({ status: schema.users.status, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id)).get())!;
const scopesOf = async (id: string) => (await d1.db.select({ scope: schema.userScopes.scope }).from(schema.userScopes).where(eq(schema.userScopes.userId, id))).map((row) => row.scope).sort();
const actions = async () => (await d1.db.select({ action: schema.activityLogs.action, entityId: schema.activityLogs.entityId }).from(schema.activityLogs)).map((row) => `${row.action} ${row.entityId}`).sort();

describe("turning a member off", () => {
  it("stops their key at the door at once, and turning them back on lets the same key in", async () => {
    const lina = withKey("cod_lina");
    expect((await lina("/api/stores/me/summary")).status).toBe(200);

    expect((await owner().patch("/api/users/u-lina", { status: "inactive" })).status).toBe(200);
    const refused = await lina("/api/stores/me/summary");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("USER_INACTIVE");
    expect(await scopesOf("u-lina")).toEqual([SCOPES.ORDERS_READ]);

    expect((await owner().patch("/api/users/u-lina", { status: "active" })).status).toBe(200);
    expect((await lina("/api/stores/me/summary")).status).toBe(200);
    expect(await actions()).toEqual(["user.deactivated u-lina", "user.reactivated u-lina"]);
  });

  it("gives the orders they were calling to the rest of the confirmation team at once, under the store's rule", async () => {
    await d1.db.insert(schema.userScopes).values({ id: "s-nour", userId: "u-nour", scope: SCOPES.ORDERS_READ_ASSIGNED, grantedAt: T });
    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-1", distribution: "in_turn", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.teamAgents).values([
      { userId: "u-lina", receiving: true, createdAt: T, updatedAt: T },
      { userId: "u-nour", receiving: true, createdAt: T, updatedAt: T },
    ] as never);
    await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
    await d1.db.insert(schema.orders).values({ id: "o-1", orderNumber: "N-1", customerId: "c1", customerName: "Amel", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1", price: 3000, deliveryFee: 600, codAmount: 3600, status: "new", assigneeId: "u-lina", createdAt: T, updatedAt: T });

    expect((await owner().patch("/api/users/u-lina", { status: "inactive" })).status).toBe(200);
    expect((await d1.db.select({ to: schema.orders.assigneeId }).from(schema.orders).get())!.to).toBe("u-nour");
  });

  it("records nothing when the status does not change, and only the change that happened", async () => {
    await owner().patch("/api/users/u-lina", { status: "active" });
    await owner().patch("/api/users/u-lina", { name: "Lina B", status: "inactive" });
    expect(await actions()).toEqual(["user.deactivated u-lina", "user.updated u-lina"]);
  });
});

describe("an admin's own account", () => {
  it("cannot be turned off or demoted by themselves", async () => {
    const off = await owner().patch("/api/users/u-owner", { status: "inactive" });
    expect(off.status).toBe(422);
    expect(off.body.code).toBe("OWN_ACCOUNT");
    const demoted = await owner().patch("/api/users/u-owner/role", { role: "staff" });
    expect(demoted.body.code).toBe("OWN_ACCOUNT");
    expect(await owner().patch("/api/users/u-owner", { role: "staff" })).toMatchObject({ body: { code: "OWN_ACCOUNT" } });
    expect(await statusOf("u-owner")).toEqual({ status: "active", role: "admin" });
    expect((await owner().patch("/api/users/u-owner", { name: "Bilal M" })).status).toBe(200);
  });
});

describe("the store's last active admin", () => {
  beforeEach(async () => {
    await d1.db.insert(schema.users).values({ id: "u-sara", name: "Sara", email: "sara@shop.dz", role: "admin", status: "active" });
  });

  it("can turn off or demote another admin while one admin remains", async () => {
    expect((await owner().patch("/api/users/u-sara/role", { role: "staff" })).status).toBe(200);
    expect(await statusOf("u-sara")).toEqual({ status: "active", role: "staff" });
    expect(await actions()).toEqual(["user.role_changed u-sara"]);
  });

  it("is kept when the other admin is turned off just before this change is written: it lands only if an admin remains", async () => {
    const racing = getDb(beforeUsersUpdate(d1.raw, () => queries.updateUser(d1.db as never, "u-owner", { status: "inactive" })));
    expect(await queries.updateUser(racing as never, "u-sara", { status: "inactive" })).toBeNull();
    const admins = await d1.db.select({ id: schema.users.id }).from(schema.users).where(sql`${schema.users.role} = 'admin' and ${schema.users.status} = 'active'`);
    expect(admins).toEqual([{ id: "u-sara" }]);
  });

  it("refuses a change that leaves no active admin, and an inactive admin does not count", async () => {
    await d1.db.update(schema.users).set({ status: "inactive" }).where(eq(schema.users.id, "u-sara"));
    const db = d1.db as never;
    expect(await queries.updateUser(db, "u-owner", { status: "inactive" })).toBeNull();
    expect(await queries.updateUser(db, "u-owner", { role: "staff" })).toBeNull();
    expect(await statusOf("u-owner")).toEqual({ status: "active", role: "admin" });
    expect(await queries.updateUser(db, "u-owner", { name: "Bilal" })).not.toBeNull();
    expect(await queries.updateUser(db, "u-sara", { role: "staff" })).not.toBeNull();
  });

  it("answers LAST_ADMIN through the API, and an unknown member is not found", async () => {
    await d1.db.update(schema.users).set({ status: "inactive" }).where(eq(schema.users.id, "u-sara"));
    const other = apiAs(d1, { ...OWNER, id: "u-api" } as AuthUser, ROUTERS);
    expect((await other.patch("/api/users/u-owner", { status: "inactive" })).body.code).toBe("LAST_ADMIN");
    expect((await other.patch("/api/users/u-nobody", { status: "inactive" })).status).toBe(404);
  });
});

describe("a member's permissions", () => {
  it("are set all at once to exactly the list, keeping who granted the ones that stay", async () => {
    const all = await owner().put("/api/users/u-lina/scopes", { scopes: ALL_SCOPES });
    expect(all.status).toBe(200);
    expect(all.body.data.scopes).toHaveLength(ALL_SCOPES.length);
    expect(await scopesOf("u-lina")).toEqual([...ALL_SCOPES].sort());
    const kept = await d1.db.select().from(schema.userScopes).where(sql`${schema.userScopes.userId} = 'u-lina' and ${schema.userScopes.scope} = ${SCOPES.ORDERS_READ}`);
    expect(kept).toMatchObject([{ grantedAt: T, grantedBy: "u-owner" }]);

    expect((await owner().put("/api/users/u-lina/scopes", { scopes: [SCOPES.ORDERS_READ_ASSIGNED, SCOPES.ORDERS_READ_ASSIGNED] })).status).toBe(200);
    expect(await scopesOf("u-lina")).toEqual([SCOPES.ORDERS_READ_ASSIGNED]);
    const logged = await actions();
    expect(logged.filter((row) => row.startsWith("user.scope_granted"))).toHaveLength(ALL_SCOPES.length - 1);
    expect(logged.filter((row) => row.startsWith("user.scope_revoked"))).toHaveLength(ALL_SCOPES.length - 1);
  });

  it("changes nothing and records nothing when they are already the list", async () => {
    expect((await owner().put("/api/users/u-lina/scopes", { scopes: [SCOPES.ORDERS_READ] })).status).toBe(200);
    expect(await actions()).toEqual([]);
    expect((await owner().put("/api/users/u-lina/scopes", { scopes: [] })).status).toBe(200);
    expect(await scopesOf("u-lina")).toEqual([]);
  });

  it("refuses the wildcard or a permission the platform does not define, and changes nothing", async () => {
    for (const scopes of [["*"], ["orders:fly"], [SCOPES.ORDERS_UPDATE, "*"]]) {
      expect((await owner().put("/api/users/u-lina/scopes", { scopes })).status).toBe(400);
    }
    expect((await owner().post("/api/users/u-lina/scopes", { scope: "*" })).status).toBe(400);
    expect((await owner().put("/api/users/u-nobody/scopes", { scopes: [] })).status).toBe(404);
    expect(await scopesOf("u-lina")).toEqual([SCOPES.ORDERS_READ]);
  });

  it("can all be given at invitation, more than one database statement holds", async () => {
    const invited = await owner().post("/api/users", { name: "Yasmine", email: "yasmine@shop.dz", scopes: ALL_SCOPES });
    expect(invited.status).toBe(201);
    expect(await scopesOf(invited.body.data.id)).toEqual([...ALL_SCOPES].sort());
    expect((await owner().post("/api/users", { name: "Wild", email: "wild@shop.dz", scopes: ["*"] })).status).toBe(400);
  }, 30_000);
});

describe("the store as every member sees it", () => {
  it("is its name, domain and logo for a member with no permission at all, and the rest stays the admin's", async () => {
    const nour = withKey("cod_nour");
    const summary = await nour("/api/stores/me/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({ name: "Boutique Amel", domain: "amel.shop", logo: null });
    const logoKey = `products/${"a".repeat(32)}.webp`;
    await d1.db.update(schema.stores).set({ logoKey });
    expect((await nour("/api/stores/me/summary")).body.data.logo).toMatchObject({ key: logoKey, url: expect.stringContaining(logoKey) });
    expect((await nour("/api/stores/me")).status).toBe(403);
    expect((await withKey("cod_owner")("/api/stores/me")).status).toBe(200);
    expect((await withKey("cod_unknown")("/api/stores/me/summary")).status).toBe(401);
  });
});
