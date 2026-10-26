// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  const watchers = new Set<(identity: unknown) => void>();
  return {
    watchers,
    fetchIdentity: vi.fn(),
    knownIdentity: vi.fn(),
    watchIdentity: vi.fn((listener: (identity: unknown) => void) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    }),
    SessionUnavailableError: class extends Error {},
  };
});
vi.mock("@/lib/session", () => session);

const settings = vi.hoisted(() => ({ getMyStore: vi.fn() }));
vi.mock("@/features/settings/api", () => settings);

let FrameSidebar: typeof import("./frame").FrameSidebar;
let FrameTopbar: typeof import("./frame").FrameTopbar;
let storeSummaryChanged: typeof import("@/features/settings/store-summary").storeSummaryChanged;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const admin = { user: { id: "u1", name: "Amina", email: "amina@example.com" }, role: "admin" as const, scopes: [] };
const store = { id: "s1", name: "Maysa", domain: "maysashop.online", logoUrl: null };

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  vi.resetModules();
  ({ FrameSidebar, FrameTopbar } = await import("./frame"));
  ({ storeSummaryChanged } = await import("@/features/settings/store-summary"));
  window.localStorage.setItem("locale", "en");
  sessionStorage.clear();
  session.fetchIdentity.mockReset().mockResolvedValue(admin);
  session.knownIdentity.mockReset().mockReturnValue(admin);
  session.watchers.clear();
  settings.getMyStore.mockReset().mockResolvedValue(store);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function visit(path: string) {
  window.history.pushState({}, "", path);
  await act(async () => {
    document.dispatchEvent(new Event("astro:after-swap"));
  });
}

async function mount(node: React.ReactNode, path: string) {
  window.history.pushState({}, "", path);
  await act(async () => root.render(node));
  await settle();
}

const current = () => Array.from(host.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute("href"));

describe("the dashboard frame", () => {
  it("lights the page it opened on, trailing slash and all", async () => {
    await mount(<FrameSidebar />, "/orders/abandoned/");
    expect(current()).toEqual(["/orders/abandoned"]);
  });

  it("follows the router: a swap moves the current item without mounting the sidebar again", async () => {
    await mount(<FrameSidebar />, "/orders");
    const aside = host.querySelector("aside");
    expect(current()).toEqual(["/orders"]);

    await visit("/customers/c_1");
    expect(current()).toEqual(["/customers"]);
    await visit("/reviews/");
    expect(current()).toEqual(["/reviews"]);
    expect(host.querySelector("aside")).toBe(aside);
  });

  it("opens a section's group when a swap lands inside it, as a fresh page did", async () => {
    await mount(<FrameSidebar />, "/dashboard");
    expect(host.querySelector('a[href="/customer-groups"]')).toBeNull();

    await visit("/customer-groups");
    expect(current()).toEqual(["/customer-groups"]);
  });

  it("hides itself on the root and in the landing-page studio, and comes back after", async () => {
    await mount(
      <>
        <FrameSidebar />
        <FrameTopbar />
      </>,
      "/landing-pages/lp_1/studio",
    );
    expect(host.innerHTML).toBe("");

    await visit("/landing-pages");
    expect(current()).toEqual(["/landing-pages"]);
    expect(host.querySelector("header")).not.toBeNull();

    await visit("/");
    expect(host.innerHTML).toBe("");
  });

  it("reads the store once a visit, however often the frame or the mobile menu mounts it", async () => {
    await mount(<FrameSidebar />, "/orders");
    await visit("/products");
    await visit("/");
    await visit("/settings");
    await settle();
    act(() => root.unmount());
    root = createRoot(host);
    await mount(<FrameSidebar />, "/orders");

    expect(settings.getMyStore).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Maysa");
  });

  it("shows a store saved in Settings without reading it again", async () => {
    await mount(<FrameSidebar />, "/settings");
    await act(async () => storeSummaryChanged({ name: "Maysa Shop", domain: "maysa.shop", logoUrl: null }));

    expect(host.textContent).toContain("Maysa Shop");
    expect(host.textContent).toContain("maysa.shop");
  });

  it("shows nothing until the server answers signed in, then follows its answers", async () => {
    session.knownIdentity.mockReturnValue(undefined);
    session.fetchIdentity.mockReturnValue(new Promise(() => {}));
    await mount(<FrameSidebar />, "/orders");
    expect(host.innerHTML).toBe("");

    await act(async () => session.watchers.forEach((watch) => watch(admin)));
    expect(current()).toEqual(["/orders"]);

    await act(async () => session.watchers.forEach((watch) => watch(null)));
    expect(host.innerHTML).toBe("");
  });

  it("offers Apps, marked new, then Integrations, AI agents, Team and Settings, and lights each on its own pages", async () => {
    await mount(<FrameSidebar />, "/apps/meta");
    const admin = Array.from(host.querySelectorAll<HTMLAnchorElement>("a[href]")).map((link) => link.getAttribute("href"));
    expect(admin.slice(admin.indexOf("/apps"))).toEqual(["/apps", "/integrations", "/mcp", "/team", "/settings"]);
    expect(host.querySelector<HTMLAnchorElement>('a[href="/apps"]')!.textContent).toBe("AppsNew");
    expect(host.querySelector<HTMLAnchorElement>('a[href="/integrations"]')!.textContent).toBe("Integrations");
    expect(host.querySelector('a[href="/whatsapp"]')).toBeNull();
    expect(current()).toEqual(["/apps"]);
  });

  it("offers Apps to staff who may see one App, and Integrations to those who may read them", async () => {
    const staff = (scopes: string[]) => ({ ...admin, role: "staff" as const, scopes });
    const remount = async (scopes: string[]) => {
      act(() => root.unmount());
      root = createRoot(host);
      session.knownIdentity.mockReturnValue(staff(scopes));
      session.fetchIdentity.mockResolvedValue(staff(scopes));
      await mount(<FrameSidebar />, "/orders");
    };
    await remount(["orders:read", "settings:integrations", "whatsapp_widget:read"]);
    expect(host.querySelector('a[href="/apps"]')).toBeNull();
    expect(host.querySelector('a[href="/integrations"]')).toBeNull();

    await remount(["orders:read", "turnstile:read"]);
    expect(host.querySelector('a[href="/apps"]')).not.toBeNull();
    expect(host.querySelector('a[href="/integrations"]')).toBeNull();

    await remount(["orders:read", "integrations:read"]);
    expect(host.querySelector('a[href="/apps"]')).toBeNull();
    expect(host.querySelector('a[href="/integrations"]')).not.toBeNull();
    expect(host.querySelector('a[href="/settings"]')).toBeNull();
  });
});
