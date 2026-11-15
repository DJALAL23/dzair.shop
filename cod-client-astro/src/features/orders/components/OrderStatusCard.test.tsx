// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderListItem } from "@/features/orders/types";
import { OrderStatusCard } from "./OrderStatusCard";
import { MoveIcon, STAGE_ICON, StageBadge, StageIcon } from "./StageBadge";
import { ORDER_STAGES } from "../../../../../cod-shared/orders/stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const NOW = new Date("2026-11-15T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

type CardOrder = Parameters<typeof OrderStatusCard>[0]["order"];
const base: CardOrder = {
  status: "new",
  stage: "new",
  needsAttention: false,
  unansweredCalls: 0,
  callbackAt: null,
  shipmentKind: null,
  carrierName: null,
  driverName: null,
  confirmedAt: null,
};

function card(overrides: Partial<CardOrder> = {}) {
  act(() => root.render(<OrderStatusCard order={{ ...base, ...overrides } satisfies Partial<OrderListItem>} />));
  const lines = Array.from(host.querySelectorAll(":scope > span > span:last-child > span")).map((line) => line.textContent);
  return { lines, text: host.textContent ?? "" };
}

describe("an order's status card", () => {
  it("names the stage alone when nothing goes with it", () => {
    expect(card().lines).toEqual(["New"]);
    expect(card({ status: "confirmed", stage: "confirmed" }).lines).toEqual(["Confirmed"]);
  });

  it("says which call a customer who does not answer is at", () => {
    expect(card({ status: "unreachable", stage: "unreachable", unansweredCalls: 2 }).lines).toEqual(["No answer · Call 2"]);
  });

  it("says when to call back, and that the time has come in the warning colour", () => {
    const later = card({ status: "unreachable", stage: "unreachable", unansweredCalls: 1, callbackAt: "2026-11-15T17:00:00.000Z" });
    expect(later.lines).toEqual(["No answer · Call 1", "Call back: Today, 18:00"]);
    expect(host.querySelector(".text-\\[var\\(--tone-critical-text\\)\\]")).toBeNull();
    const due = card({ callbackAt: "2026-11-15T09:00:00.000Z" });
    expect(due.lines).toEqual(["New", "Call back: Call back now"]);
    expect(host.querySelector(".text-\\[var\\(--tone-critical-text\\)\\]")?.textContent).toBe("Call back: Call back now");
    expect(card({ callbackAt: "2026-11-16T08:30:00.000Z" }).lines[1]).toBe("Call back: Tomorrow, 09:30");
  });

  it("names who carries a shipped order, and says so when the name is not known", () => {
    expect(card({ status: "ready", stage: "in_transit", shipmentKind: "carrier", carrierName: "Yalidine" }).lines).toEqual(["In transit", "Delivery company: Yalidine"]);
    expect(card({ status: "ready", stage: "delivered", shipmentKind: "driver", driverName: "Amine B" }).lines).toEqual(["Delivered", "Our driver: Amine B"]);
    expect(card({ status: "ready", stage: "handoff_pending", shipmentKind: "carrier" }).lines).toEqual(["Awaiting carrier", "Delivery company: Delivery company"]);
  });

  it("tells how many calls went unanswered before the order was cancelled", () => {
    expect(card({ status: "cancelled", stage: "cancelled", unansweredCalls: 1 }).lines).toEqual(["Cancelled", "After 1 call without an answer"]);
    expect(card({ status: "cancelled", stage: "cancelled", unansweredCalls: 3 }).lines).toEqual(["Cancelled", "After 3 calls without an answer"]);
  });

  it("puts a warning in place of the stage's icon when the delivery needs the merchant", () => {
    card({ status: "ready", stage: "in_transit", needsAttention: true, shipmentKind: "carrier", carrierName: "Yalidine" });
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Needs your attention");
    card({ status: "ready", stage: "in_transit", shipmentKind: "carrier", carrierName: "Yalidine" });
    expect(host.querySelector('[role="img"]')).toBeNull();
  });
});

describe("the stage's icon", () => {
  it("gives every stage an icon, and no two stages the same one", () => {
    expect(Object.keys(STAGE_ICON).sort()).toEqual([...ORDER_STAGES].sort());
    expect(new Set(Object.values(STAGE_ICON)).size).toBe(ORDER_STAGES.length);
  });

  it("draws the stage's own icon in the badge, as the card does", () => {
    for (const stage of ["unreachable", "delivered"] as const) {
      act(() => root.render(<StageBadge stage={stage} />));
      const badge = host.innerHTML;
      act(() => root.render(<OrderStatusCard order={{ ...base, status: stage === "delivered" ? "ready" : stage, stage }} />));
      const icon = host.querySelector("svg")!.outerHTML.replace(/ width="\d+"| height="\d+"/g, "");
      expect(badge.replace(/ width="\d+"| height="\d+"/g, "")).toContain(icon);
    }
  });

  it("draws a move with the icon of the stage it leads to", () => {
    for (const [status, stage] of [["confirmed", "confirmed"], ["unreachable", "unreachable"], ["preparing", "preparing"], ["ready", "ready_to_ship"], ["cancelled", "cancelled"]] as const) {
      act(() => root.render(<MoveIcon status={status} size={14} />));
      const move = host.innerHTML;
      act(() => root.render(<StageIcon stage={stage} size={14} />));
      expect(move).toBe(host.innerHTML);
    }
  });
});
