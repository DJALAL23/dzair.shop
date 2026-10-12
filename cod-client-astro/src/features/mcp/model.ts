import type { McpConnection } from "./types";

/** The MCP endpoint for a given API base URL, e.g. "https://api.example.com/mcp". */
export function mcpApiUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, "")}/mcp`;
}

/** Keep the admin's own connections out of the team tab. */
export function otherUsersConnections(teamConnections: McpConnection[], currentUserId: string) {
  return teamConnections.filter((connection) => connection.user && connection.user.id !== currentUserId);
}

/** Stable identity for a connection row, used for pending-revoke state and list keys. */
export function connectionKey(conn: McpConnection): string {
  return conn.user ? `${conn.user.id}:${conn.clientId}` : conn.clientId;
}

export function mcpErrorMessage(cause: unknown, t: (key: string) => string) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "MCP_CONNECTION_NOT_FOUND") return t("my_connections.revoke_error");
  if (code === "PERMISSION_DENIED") return t("my_connections.revoke_error");
  return t("my_connections.revoke_error");
}
