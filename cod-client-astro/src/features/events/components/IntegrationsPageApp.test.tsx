// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  fetchIdentity: vi.fn(),
  knownIdentity: vi.fn(),
  watchIdentity: vi.fn(() => () => undefined),
  currentJwt: vi.fn(),
  refreshJwt: vi.fn(),
  SessionUnavailableError: class extends Error {},
}));
vi.mock("@/lib/session", () => session);
const api = vi.hoisted(() => ({ apiFetch: vi.fn(async () => ({ success: true, data: [] })), ApiError: class extends Error {} }));
vi.mock("@/lib/api", () => api);

import IntegrationsPageApp from "./IntegrationsPageApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const staff = (scopes: string[]) => ({ user: { id: "u2", name: "Samira", email: "samira@example.com" }, role: "staff" as const, scopes });

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  api.apiFetch.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function open(scopes: string[]) {
  session.knownIdentity.mockReturnValue(staff(scopes));
  session.fetchIdentity.mockResolvedValue(staff(scopes));
  await act(async () => root.render(<IntegrationsPageApp />));
  await act(async () => {});
}

describe("the Integrations page's door", () => {
  it("opens for staff with the permission the server asks for", async () => {
    await open(["integrations:read"]);
    expect(host.querySelector("h1")!.textContent).toContain("Integrations");
    expect(api.apiFetch).toHaveBeenCalledWith("/api/event-consumers");
    expect(host.textContent).not.toContain("Add webhook");
    expect(api.apiFetch).not.toHaveBeenCalledWith("/api/stores/me");
  });

  it("stays shut, asking nothing of the server, for staff without it", async () => {
    await open(["orders:read", "meta:manage", "settings:integrations"]);
    expect(host.textContent).toContain("You do not have permission to access this page.");
    expect(api.apiFetch).not.toHaveBeenCalled();
  });
});
