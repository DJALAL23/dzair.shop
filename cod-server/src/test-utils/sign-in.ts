import type { Context } from "hono";
import type { AppContext, AuthUser } from "@/types";

/** What authMiddleware leaves on a dashboard request: the signed-in user, and the Author of what they change. */
export function signIn(c: Context<AppContext>, user: AuthUser): void {
  c.set("user", user);
  c.set("author", { actor: { kind: "staff", id: user.id, name: user.name }, origin: "dashboard" });
}
