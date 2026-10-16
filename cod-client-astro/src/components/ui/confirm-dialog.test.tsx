// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfirmDialogProvider, useConfirmDialog, type ConfirmDialogOptions } from "./confirm-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let ask: ((options: ConfirmDialogOptions) => Promise<boolean>) | null = null;

function Probe() {
  ask = useConfirmDialog();
  return null;
}

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ConfirmDialogProvider><Probe /></ConfirmDialogProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!;
const confirmButton = () => Array.from(dialog().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Delete")!;

function type(value: string) {
  const input = dialog().querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function open(options: Partial<ConfirmDialogOptions> = {}) {
  let answer!: Promise<boolean>;
  act(() => {
    answer = ask!({ title: "Delete Robe?", confirmLabel: "Delete", tone: "danger", ...options });
  });
  return answer;
}

describe("a confirmation that must be typed", () => {
  it("keeps Delete off until the exact name is typed, then confirms", async () => {
    const answer = open({ confirmText: "Robe d'été" });
    expect(dialog().textContent).toContain("Type Robe d'été to confirm");
    expect(document.activeElement).toBe(dialog().querySelector("input"));
    expect(confirmButton().disabled).toBe(true);
    type("robe d'été");
    expect(confirmButton().disabled).toBe(true);
    type("Robe d'été ");
    expect(confirmButton().disabled).toBe(false);
    act(() => confirmButton().click());
    await expect(answer).resolves.toBe(true);
  });

  it("confirms with Enter only once the text matches", async () => {
    const answer = open({ confirmText: "ORD-1" });
    const form = dialog().querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(dialog()).not.toBeNull();
    type("ORD-1");
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await expect(answer).resolves.toBe(true);
  });

  it("starts empty again on the next request", async () => {
    const first = open({ confirmText: "A" });
    type("A");
    act(() => (Array.from(dialog().querySelectorAll("button")).find((b) => b.textContent === "Cancel") as HTMLButtonElement).click());
    await expect(first).resolves.toBe(false);
    open({ confirmText: "B" });
    expect(dialog().querySelector("input")!.value).toBe("");
    expect(confirmButton().disabled).toBe(true);
  });
});

describe("what an action does", () => {
  it("lists what goes, what stays and what to watch", () => {
    open({ consequences: [{ text: "Its 2 images are removed" }, { text: "Orders keep their lines", kept: true }, { text: "1 order still to ship", warning: true }] });
    const items = Array.from(dialog().querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["Its 2 images are removed", "Orders keep their lines", "1 order still to ship"]);
  });

  it("asks nothing to be typed when there is nothing to type", () => {
    open();
    expect(dialog().querySelector("input")).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });
});
