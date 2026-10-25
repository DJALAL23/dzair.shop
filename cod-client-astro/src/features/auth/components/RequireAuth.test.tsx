// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  class SessionUnavailableError extends Error {}
  return { fetchIdentity: vi.fn(), knownIdentity: vi.fn(), watchIdentity: vi.fn(() => () => undefined), SessionUnavailableError };
});
vi.mock("@/lib/session", () => session);

import { renderToStaticMarkup } from "react-dom/server";
import { RequireAuth, useIdentity } from "./RequireAuth";
import { PageSkeleton } from "@/components/layout/PageSkeleton";

function Who() {
  return <p id="who">{useIdentity()?.user.email ?? "nobody"}</p>;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  document.body.innerHTML = '<div data-gate-spinner="required"></div><div data-auth-gate="required" hidden><div id="host"></div></div>';
  host = document.getElementById("host") as HTMLDivElement;
  root = createRoot(host);
  session.fetchIdentity.mockReset();
  session.knownIdentity.mockReset();
  replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, replace, pathname: "/orders/" },
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function mount() {
  await act(async () => {
    root.render(
      <RequireAuth>
        <p id="page">Orders</p>
      </RequireAuth>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const identity = { user: { id: "u1", email: "amina@example.com" }, role: "admin" as const, scopes: [] };
const gate = () => document.querySelector<HTMLElement>('[data-auth-gate="required"]')!;
const retryButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Retry");

describe("the sign-in gate", () => {
  it("sends a visitor with no session to sign in", async () => {
    session.fetchIdentity.mockResolvedValue(null);
    await mount();

    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Forders%2F");
  });

  it("keeps the merchant on the page when the session could not be checked, and lets them retry", async () => {
    session.fetchIdentity.mockRejectedValueOnce(new session.SessionUnavailableError("429"));
    await mount();

    expect(replace).not.toHaveBeenCalled();
    expect(gate().hidden).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("couldn't check your session");
    expect(document.getElementById("page")).toBeNull();

    session.fetchIdentity.mockResolvedValueOnce(identity);
    await act(async () => { retryButton()!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(document.getElementById("page")?.textContent).toBe("Orders");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the page at once when the session is already known, without waiting for a check", async () => {
    session.knownIdentity.mockReturnValue(identity);
    session.fetchIdentity.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root.render(
        <RequireAuth>
          <p id="page">Orders</p>
        </RequireAuth>,
      );
    });

    expect(document.getElementById("page")?.textContent).toBe("Orders");
    expect(document.querySelector("[data-auth-state]")).toBeNull();
    expect(gate().hidden).toBe(false);
  });

  it("gives the page the known merchant from its first render", async () => {
    session.knownIdentity.mockReturnValue(identity);
    session.fetchIdentity.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root.render(
        <RequireAuth>
          <Who />
        </RequireAuth>,
      );
    });

    expect(document.getElementById("who")?.textContent).toBe("amina@example.com");
  });

  it("sends a visitor known to be signed out to sign in at once", async () => {
    session.knownIdentity.mockReturnValue(null);
    session.fetchIdentity.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root.render(
        <RequireAuth>
          <p id="page">Orders</p>
        </RequireAuth>,
      );
    });

    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Forders%2F");
    expect(document.getElementById("page")).toBeNull();
  });

  it("shows the page skeleton while the session is checked, the one the static shell shows", async () => {
    session.knownIdentity.mockReturnValue(undefined);
    session.fetchIdentity.mockReturnValue(new Promise(() => {}));
    await mount();

    const pending = host.querySelector<HTMLElement>("[data-skeleton]");
    expect(pending?.dataset.authState).toBe("pending");
    expect(pending?.outerHTML.replace(/ data-auth-state="[^"]*"/, "")).toBe(
      renderToStaticMarkup(<PageSkeleton />),
    );
    expect(document.getElementById("page")).toBeNull();
  });

  it("swaps the static skeleton for the page once the merchant is known", async () => {
    document.body.innerHTML = `<main>${renderToStaticMarkup(<PageSkeleton gate="required" />)}<div data-auth-gate="required" hidden><div id="host"></div></div></main>`;
    host = document.getElementById("host") as HTMLDivElement;
    act(() => root.unmount());
    root = createRoot(host);
    expect(document.querySelector('[data-gate-spinner="required"]')).not.toBeNull();

    session.fetchIdentity.mockResolvedValue(identity);
    await mount();

    expect(document.querySelector("[data-skeleton]")).toBeNull();
    expect(gate().hidden).toBe(false);
    expect(document.getElementById("page")?.textContent).toBe("Orders");
  });
});
