import type { StaffActor } from "@/types";
import type { Acting } from "@/lib/acting";
import type { Author } from "../../../cod-shared/events/actor";

/**
 * McpProps — the per-request identity snapshot handed to the MCP server.
 *
 * Populated at OAuth `completeAuthorization` time by the
 * `@cloudflare/workers-oauth-provider` default handler and carried into the
 * stateless SDK v2 handler as the provider's application props, read via
 * `getMcpAuthContext()` inside `createCodMcpServer` (`./server-factory.ts`).
 * Every tool execution reads from these fields:
 *   • `scopes` — decides which tools got registered for this request
 *     (see `./registry.ts buildToolsForUser`)
 *   • `role`   — admin wildcard bypass
 *   • `userId` + `name` + `email` — audit-log attribution
 *
 * Stable shape intentional: changes here cascade to the registry, server
 * factory, activity log, and every ai-tools factory call site.
 */
export interface McpProps extends Record<string, unknown> {
  /** Better Auth user UUID. */
  userId: string;
  /** Admin or staff; admins bypass every scope check. */
  role: "admin" | "staff";
  /**
   * Scopes granted to this OAuth grant. Never includes "*" — admin bypass uses
   * `role`, not a wildcard scope.
   */
  scopes: string[];
  /** Display name for audit log attribution. May be empty string if user row lacks it. */
  name: string;
  /** User email — useful for log correlation with the existing activity-log shape. */
  email: string;
}

/** The grant as the one acting: an admin holds every permission, as on the dashboard (`authMiddleware`). */
export function actorOf(props: McpProps): StaffActor {
  return { id: props.userId, name: props.name || props.email, role: props.role, scopes: props.role === "admin" ? ["*"] : props.scopes };
}

/** The grant as the Author of a change: an agent, acting for the staff member who connected it. */
export function agentAuthorOf(props: McpProps): Author {
  return { actor: { kind: "agent", id: props.userId, name: props.name || props.email }, origin: "agent" };
}

/** The grant at an entry point: the agent as Author, and the staff member it acts for. */
export function agentActingOf(props: McpProps): Acting & { staff: StaffActor } {
  return { author: agentAuthorOf(props), staff: actorOf(props) };
}
