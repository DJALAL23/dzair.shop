// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusMoves } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";
import { OrderNextStepCard } from "./OrderNextStepCard";
import { OrderMobileActionBar } from "./OrderMobileActionBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onMove = vi.fn();
const onShip = vi.fn();

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  onMove.mockReset();
  onShip.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const names = (within: Element) => Array.from(within.querySelectorAll("button")).map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim());
const props = (status: OrderStatus, calls = 0, canShip = false) => ({ moves: statusMoves({ status, hasShipment: false }), status, calls, canShip, busy: false, onMove, onShip });

describe("the next step on a wide screen", () => {
  it("puts a waiting order's two results of a call side by side, the confirmation first, and cancelling apart", () => {
    act(() => root.render(<OrderNextStepCard {...props("unreachable", 2)} />));
    const outcomes = host.querySelector('[role="group"][aria-label="Result of the call"]')!;
    expect(names(outcomes)).toEqual(["Confirm order", "No answer · Call 3"]);
    expect(names(host)).toEqual(["Confirm order", "No answer · Call 3", "Cancel order"]);
    const look = (name: string) => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)!.className;
    expect(look("Cancel order")).toContain("text-destructive");
    expect(look("Confirm order")).toContain("bg-primary");
    expect(look("No answer · Call 3")).not.toContain("bg-primary");
    expect(host.querySelector('button[aria-label="More actions"]')).toBeNull();
  });

  it("offers a confirmed order preparing first, keeps another call without an answer behind More, and records it from there", async () => {
    act(() => root.render(<OrderNextStepCard {...props("confirmed")} />));
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(names(host)).toEqual(["More actions", "Start preparing", "Ready to ship", "Cancel order"]);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click());
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim() === "No answer · Call 1")!;
    await act(async () => item.click());
    expect(onMove).toHaveBeenCalledWith("unreachable");
  });

  it("gives shipping the colour of the step to take once an order can ship, and the usual next step its plain look", () => {
    act(() => root.render(<OrderNextStepCard {...props("preparing", 0, true)} />));
    const look = (name: string) => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)!.className;
    expect(look("Ship")).toContain("bg-primary");
    expect(look("Ready to ship")).not.toContain("bg-primary");
  });

  it("leads with shipping a ready order, and keeps cancelling", () => {
    act(() => root.render(<OrderNextStepCard {...props("ready", 0, true)} />));
    expect(names(host)).toEqual(["Ship", "Cancel order"]);
  });
});

describe("the next step on a phone", () => {
  it("gives a waiting order both results of the call within thumb's reach, the confirmation last, with no way back to make room", async () => {
    act(() => root.render(<OrderMobileActionBar {...props("new")} />));
    const outcomes = host.querySelector('[role="group"][aria-label="Result of the call"]')!;
    expect(names(outcomes)).toEqual(["No answer · Call 1", "Confirm order"]);
    expect(outcomes.textContent).toBe("No answerCall 1Confirm");
    expect(host.querySelector('a[href="/orders"]')).toBeNull();
    await act(async () => outcomes.querySelectorAll("button")[0]!.click());
    expect(onMove).toHaveBeenCalledWith("unreachable");
  });

  it("offers a confirmed order its one next step, beside the way back", () => {
    act(() => root.render(<OrderMobileActionBar {...props("confirmed")} />));
    expect(host.querySelector('a[href="/orders"]')).not.toBeNull();
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(names(host)).toEqual(["Start preparing"]);
  });

  it("offers shipping a ready order, and nothing for an order with no next step", () => {
    act(() => root.render(<OrderMobileActionBar {...props("ready", 0, true)} />));
    expect(names(host)).toEqual(["Ship"]);
    act(() => root.render(<OrderMobileActionBar {...props("cancelled")} />));
    expect(host.innerHTML).toBe("");
  });
});
