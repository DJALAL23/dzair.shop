// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => new Promise(() => {})),
  apiFetchBlob: vi.fn(),
  publicApiUrl: () => "http://api.test",
  ApiError: class extends Error {},
}));

import { RootGate } from "./RootPageApp";
import { PageSkeleton } from "@/components/layout/PageSkeleton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  document.body.innerHTML = `<main>${renderToStaticMarkup(<PageSkeleton gate="required" />)}<div data-auth-gate="required" hidden><div id="host"></div></div></main>`;
  root = createRoot(document.getElementById("host")!);
  session.fetchIdentity.mockReset().mockReturnValue(new Promise(() => {}));
  session.knownIdentity.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const gate = () => document.querySelector<HTMLElement>('[data-auth-gate="required"]')!;

describe("the root page", () => {
  it("drops the skeleton and shows its own wait on the root, which only redirects", async () => {
    window.history.pushState({}, "", "/");
    await act(async () => root.render(<RootGate />));

    expect(document.querySelector("[data-skeleton]")).toBeNull();
    expect(gate().hidden).toBe(false);
    expect(document.querySelector('[data-auth-state="pending"]')?.textContent).toBe("CodFlow");
  });

  it("leaves a detail page's skeleton to that page's gate", async () => {
    window.history.pushState({}, "", "/orders/ord_1");
    await act(async () => root.render(<RootGate />));

    expect(document.querySelector('[data-gate-spinner="required"]')).not.toBeNull();
    expect(gate().hidden).toBe(true);
  });
});
