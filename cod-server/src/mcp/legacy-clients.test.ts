import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("./registry", () => ({
  buildToolsForUser: () => ({ listCustomers: { description: "List customers", execute: async () => ({ success: true }) } }),
  TOOL_REGISTRY: [],
}));

import { createCodMcpHandler } from "./server-factory";
import type { McpProps } from "./props";
import type { Env } from "@/types/env";

const env = { DB: {} } as unknown as Env;
const props: McpProps = { userId: "u1", role: "admin", scopes: [], name: "Ada", email: "ada@example.com" };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props } as unknown as ExecutionContext;

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://api.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function jsonRpc(response: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await response.text();
  const data = text.trim().startsWith("{")
    ? text
    : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("");
  return JSON.parse(data);
}

describe("MCP clients on the 2025 initialize handshake", () => {
  for (const protocolVersion of ["2025-03-26", "2025-06-18"]) {
    it(`answers initialize at ${protocolVersion} instead of refusing it`, async () => {
      const response = await createCodMcpHandler(env)(
        post({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion, capabilities: {}, clientInfo: { name: "go-client", version: "1" } },
        }),
        env,
        ctx,
      );

      expect(response.status).toBe(200);
      const message = await jsonRpc(response);
      expect(message.error).toBeUndefined();
      expect(message.result?.protocolVersion).toBe(protocolVersion);
    });
  }

  it("lists tools without a session after initialize", async () => {
    const response = await createCodMcpHandler(env)(
      post(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        { "mcp-protocol-version": "2025-06-18" },
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const message = await jsonRpc(response);
    expect(message.error).toBeUndefined();
    expect((message.result?.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["listCustomers"]);
  });
});
