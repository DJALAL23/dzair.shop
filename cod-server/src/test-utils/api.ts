/**
 * The merchant API as one signed-in person calls it, over a real database:
 * routers mounted at their paths, the error handler and the validation hook
 * of the deployed app, and answers read back as `{ status, body }`.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext, AuthUser } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { signIn } from "./sign-in";
import type { TestD1 } from "./d1";

/** A staff member holding exactly these permissions — never an admin, whose role skips every check. */
export function staff(scopes: string[]): AuthUser {
  return { id: "staff_1", name: "Staff", email: "staff@example.com", role: "staff", status: "active", apiKey: "cod_staff_key", scopes } as AuthUser;
}

export const ADMIN = { id: "admin_1", name: "Admin", email: "admin@example.com", role: "admin", status: "active", apiKey: "cod_admin_key", scopes: ["*"] } as AuthUser;

export interface Answer {
  status: number;
  body: any;
}

export interface Api {
  get(path: string): Promise<Answer>;
  put(path: string, body?: unknown): Promise<Answer>;
  post(path: string, body?: unknown): Promise<Answer>;
  patch(path: string, body?: unknown): Promise<Answer>;
  delete(path: string): Promise<Answer>;
}

export function apiAs(d1: TestD1, user: AuthUser, routers: Record<string, OpenAPIHono<AppContext>>): Api {
  const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, user);
    await next();
  });
  app.onError(errorHandler);
  for (const [path, router] of Object.entries(routers)) app.route(path, router);

  const send = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await app.request(path, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return {
    get: (path) => send("GET", path),
    put: (path, body) => send("PUT", path, body),
    post: (path, body) => send("POST", path, body),
    patch: (path, body) => send("PATCH", path, body),
    delete: (path) => send("DELETE", path),
  };
}
