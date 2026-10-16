// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ createTeamMember: vi.fn() }));
vi.mock("@/features/team/api", () => api);

import { InviteDialog } from "./InviteDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.createTeamMember.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const mount = (props: Partial<React.ComponentProps<typeof InviteDialog>> = {}) =>
  act(() => root.render(<InviteDialog open onClose={props.onClose ?? vi.fn()} onSuccess={props.onSuccess} />));

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const buttons = () => Array.from(dialog().querySelectorAll<HTMLButtonElement>("button"));
const buttonLabelled = (label: RegExp) => buttons().find((b) => label.test(b.textContent ?? ""))!;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the invite dialog uses the shared dialog layout", () => {
  it("shows the icon, title and description in the dialog's own header", () => {
    mount();
    const header = dialog().querySelector("h2")!;
    expect(header.textContent).toBe("Invite new user");
    expect(dialog().querySelector("#" + CSS.escape(header.id) + " ~ p")?.textContent).toBe("Onboard new team member");
    expect(header.closest("div")!.parentElement!.querySelector("span svg")).not.toBeNull();
  });

  it("keeps Cancel and Send in the footer, outside the form, and Send submits the form", () => {
    mount();
    const form = dialog().querySelector("form")!;
    const cancel = buttonLabelled(/^Cancel$/);
    const send = buttonLabelled(/Send invite/);
    expect(form.contains(cancel)).toBe(false);
    expect(form.contains(send)).toBe(false);
    expect(send.type).toBe("submit");
    expect(send.getAttribute("form")).toBe(form.id);
    expect(cancel.parentElement).toBe(send.parentElement);
  });

  it("puts the cursor in the name field", () => {
    mount();
    expect(document.activeElement).toBe(dialog().querySelector("input"));
  });

  it("explains role and email language with a tip, not a paragraph", () => {
    mount();
    expect(dialog().querySelectorAll("form [aria-label], form button[type='button']").length).toBeGreaterThan(0);
    expect(dialog().textContent).not.toContain("Admins can do everything");
  });

  it("offers a staff member the permission groups, collapsed", () => {
    mount();
    expect(dialog().textContent).toContain("Permissions");
    expect(dialog().textContent).toContain("0 selected");
    expect(dialog().querySelectorAll("form input[type='checkbox']").length).toBeGreaterThan(0);
  });
});

describe.each(["ar", "fr"])("in %s", (locale) => {
  it("every string resolves: no raw translation key reaches the screen", () => {
    window.localStorage.setItem("locale", locale);
    mount();
    expect(dialog().textContent).not.toMatch(/invite_dialog|scope_categories|roles\./);
    expect(dialog().querySelector("h2")!.textContent).not.toBe("Invite new user");
  });
});

describe("inviting a member", () => {
  it("refuses an empty name or email inside the dialog, with an alert, without calling the server", () => {
    mount();
    act(() => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Please fill in all required fields");
    expect(api.createTeamMember).not.toHaveBeenCalled();
  });

  it("shows the result in the same dialog: the key, the password and a single Done in the footer", async () => {
    api.createTeamMember.mockResolvedValue({
      apiKey: "cod_key_123",
      tempPassword: "Temp-Pass-9",
      user: { name: "Sara" },
      emailSent: false,
      emailError: null,
    });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    mount({ onClose, onSuccess });
    const [name, email] = Array.from(dialog().querySelectorAll<HTMLInputElement>("form input"));
    type(name, "Sara");
    type(email, "sara@example.com");
    await act(async () => {
      dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(api.createTeamMember).toHaveBeenCalledWith(expect.objectContaining({ name: "Sara", email: "sara@example.com", role: "staff" }));
    expect(dialog().querySelector("h2")!.textContent).toBe("Member added");
    expect(Array.from(dialog().querySelectorAll<HTMLInputElement>("input")).map((i) => i.value)).toEqual(["cod_key_123", "Temp-Pass-9"]);
    expect(dialog().textContent).toContain("Share the temporary password with the member manually.");
    expect(dialog().querySelector("form")).toBeNull();
    const done = buttonLabelled(/^Done$/);
    act(() => done.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while the invite is being sent", async () => {
    let finish!: (value: unknown) => void;
    api.createTeamMember.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    mount({ onClose });
    const [name, email] = Array.from(dialog().querySelectorAll<HTMLInputElement>("form input"));
    type(name, "Sara");
    type(email, "sara@example.com");
    act(() => {
      dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(buttonLabelled(/Sending/).disabled).toBe(true);
    expect(buttonLabelled(/^Cancel$/).disabled).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ apiKey: "k", tempPassword: "p", user: { name: "Sara" }, emailSent: true, emailError: null }));
  });
});
