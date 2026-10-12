import { describe, expect, it } from "vitest";
import {
  connectionKey,
  mcpApiUrl,
  mcpErrorMessage,
  otherUsersConnections,
} from "./model";
import type { McpConnection } from "./types";

const t = (key: string) => key;

const connection = (overrides: Partial<McpConnection> = {}): McpConnection => ({
  clientId: "claude",
  clientName: "Claude",
  clientIconUrl: null,
  clientHomepageUrl: null,
  scopes: ["orders:read"],
  connectedAt: "2026-08-26T00:00:00.000Z",
  lastUsedAt: null,
  active: true,
  ...overrides,
});

describe("mcp model", () => {
  it("derives the MCP URL from the API base", () => {
    expect(mcpApiUrl("https://api.example.com")).toBe("https://api.example.com/mcp");
    expect(mcpApiUrl("https://api.example.com/")).toBe("https://api.example.com/mcp");
  });

  it("excludes the admin's own connections from the team view", () => {
    const mine = connection({ clientId: "mine", user: { id: "admin-1", name: "Admin", email: "a@b.dz" } });
    const theirs = connection({ clientId: "claude", user: { id: "staff-1", name: "Staff", email: "s@b.dz" } });
    expect(otherUsersConnections([mine, theirs], "admin-1").map((c) => c.clientId)).toEqual(["claude"]);
    expect(otherUsersConnections([theirs], "admin-1").map((c) => c.clientId)).toEqual(["claude"]);
  });

  it("builds a stable row key including the owner for team rows", () => {
    expect(connectionKey(connection())).toBe("claude");
    expect(connectionKey(connection({ user: { id: "staff-1", name: "S", email: "s@b.dz" } }))).toBe("staff-1:claude");
  });

  it("maps revoke failures to the localized message", () => {
    expect(mcpErrorMessage({ code: "MCP_CONNECTION_NOT_FOUND" }, t)).toBe("my_connections.revoke_error");
    expect(mcpErrorMessage({ code: "PERMISSION_DENIED" }, t)).toBe("my_connections.revoke_error");
    expect(mcpErrorMessage(new Error("boom"), t)).toBe("my_connections.revoke_error");
  });
});
