// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMember } from "@/features/team/types";

const api = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
  setTeamMemberStatus: vi.fn(),
  setTeamMemberScopes: vi.fn(),
  rotateTeamMemberApiKey: vi.fn(),
  listUserActivityLogs: vi.fn(),
}));
vi.mock("@/features/team/api", () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: toast }));
const me = vi.hoisted(() => ({ id: "u-owner" }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: ["*"], user: { id: me.id, email: "bilal@shop.dz" } }),
  canScope: () => true,
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { TeamMemberDetail } from "./TeamMemberDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINA: TeamMember = { id: "u-lina", name: "Lina", email: "lina@shop.dz", role: "staff", status: "active", scopes: ["orders:read_assigned", "orders:update"], createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z" } as TeamMember;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  me.id = "u-owner";
  for (const fn of [...Object.values(api), ...Object.values(toast)]) fn.mockReset();
  api.listUserActivityLogs.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function open(member: TeamMember) {
  api.getTeamMember.mockResolvedValue(member);
  await act(async () =>
    root.render(
      <ConfirmDialogProvider>
        <TeamMemberDetail memberId={member.id} />
      </ConfirmDialogProvider>,
    ),
  );
  await act(async () => {});
}

const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
const click = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button "${label}"`);
  await act(async () => target.click());
};
const section = (title: string) => Array.from(host.querySelectorAll("section")).find((s) => s.querySelector("h2")?.textContent === title)!;

describe("a member's page", () => {
  it("shows what they may do by part of the store, and changes it right here in one save", async () => {
    await open(LINA);
    const permissions = section("Permissions");
    expect(permissions.textContent).toContain("Orders");
    expect(permissions.textContent).toContain("Only their own");

    await click("Manage permissions");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Lina");
    const update = Array.from(dialog.querySelectorAll("label")).find((label) => label.textContent?.includes("orders:update"))!;
    await act(async () => update.querySelector("input")!.click());
    expect(update.textContent).toContain("Will remove");
    api.setTeamMemberScopes.mockResolvedValue({ ...LINA, scopes: ["orders:read_assigned"] });
    await click("Save changes");

    expect(api.setTeamMemberScopes).toHaveBeenCalledWith("u-lina", ["orders:read_assigned"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(section("Permissions").textContent).not.toContain("Update");
  });

  it("deactivates them only once confirmed, then offers to reactivate them", async () => {
    await open(LINA);
    expect(section("Access").textContent).toContain("Can sign in, and their API key works.");

    await click("Deactivate");
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')!;
    expect(confirm.textContent).toContain("Deactivate Lina?");
    expect(api.setTeamMemberStatus).not.toHaveBeenCalled();
    api.setTeamMemberStatus.mockResolvedValue({ ...LINA, status: "inactive" });
    await act(async () => Array.from(confirm.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Deactivate")!.click());

    expect(api.setTeamMemberStatus).toHaveBeenCalledWith("u-lina", "inactive");
    expect(toast.success).toHaveBeenCalledWith("Lina is deactivated");
    expect(section("Access").textContent).toContain("Can't sign in, and their API key is refused.");
    expect(host.textContent).toContain("Inactive");

    api.setTeamMemberStatus.mockResolvedValue(LINA);
    await click("Reactivate");
    expect(api.setTeamMemberStatus).toHaveBeenLastCalledWith("u-lina", "active");
    expect(button("Deactivate")).toBeDefined();
  });

  it("never offers an admin to deactivate their own account", async () => {
    me.id = "u-lina";
    await open(LINA);
    expect(button("Deactivate")).toBeUndefined();
    expect(section("Access").textContent).toContain("This is your account.");
  });

  it("says an admin can do everything, with no permissions to manage", async () => {
    await open({ ...LINA, role: "admin", scopes: ["*"] });
    expect(section("Permissions").textContent).toContain("Admins can do everything in the store.");
    expect(button("Manage permissions")).toBeUndefined();
  });

  it("says plainly when a member has no permissions yet", async () => {
    await open({ ...LINA, scopes: [] });
    expect(section("Permissions").textContent).toContain("No permissions yet.");
  });

  it("shows why a change was refused", async () => {
    await open(LINA);
    await click("Deactivate");
    api.setTeamMemberStatus.mockRejectedValue(Object.assign(new Error("refused"), { code: "LAST_ADMIN" }));
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')!;
    await act(async () => Array.from(confirm.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Deactivate")!.click());
    expect(toast.error).toHaveBeenCalledWith("Your store needs at least one active admin.");
    expect(button("Deactivate")).toBeDefined();
  });
});

describe.each(["ar", "fr"])("in %s", (locale) => {
  it("every string resolves: no raw translation key reaches the screen", async () => {
    window.localStorage.setItem("locale", locale);
    await open(LINA);
    expect(host.textContent).not.toMatch(/member\.|scope_categories|scope_actions|table\./);
  });
});
