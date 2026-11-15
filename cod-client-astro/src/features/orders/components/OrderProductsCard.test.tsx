// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail, OrderProduct } from "@/features/orders/types";
import type { OrderStage } from "../../../../../cod-shared/orders/stage";

vi.mock("@/features/orders/api", () => ({ setLineReturn: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { OrderProductsCard } from "./OrderProductsCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const line = (returnedQuantity: number): OrderProduct => ({
  id: "l1",
  orderId: "o1",
  productId: "p1",
  productName: "Robe",
  variantId: null,
  variantLabel: null,
  quantity: 2,
  pricePerUnit: 3000,
  lineTotal: 6000,
  status: returnedQuantity === 0 ? "fulfilled" : returnedQuantity === 2 ? "returned" : "partially_returned",
  returnedQuantity,
  createdAt: "2026-11-12T09:39:00.000Z",
  offerId: null,
  offerName: null,
  reward: false,
  discount: 0,
});

function render(stage: OrderStage, returnedQuantity: number) {
  const order = { id: "o1", stage, products: [line(returnedQuantity)], price: 6000, deliveryFee: 400, couponCode: null, couponDiscount: 0, deliveryOfferId: null, deliveryOfferName: null } as unknown as OrderDetail;
  act(() => root.render(<OrderProductsCard order={order} locale="en" canRecordRefused={false} onChanged={() => {}} />));
  return host.textContent ?? "";
}

describe("what became of an order's units", () => {
  it("names units the customer kept back at a delivery as refused at the door", () => {
    expect(render("delivered", 1)).toContain("1 unit refused at the door");
  });

  it("says a cancelled order's units went back to stock, never that the customer refused them", () => {
    const text = render("cancelled", 2);
    expect(text).toContain("2 units back in stock");
    expect(text).not.toContain("refused");
  });

  it("says a returned parcel's units went back to stock", () => {
    const text = render("returned", 2);
    expect(text).toContain("2 units back in stock");
    expect(text).not.toContain("refused");
  });

  it("marks a refusal in the warning colour, and units back in stock quietly", () => {
    const note = (stage: OrderStage) => {
      render(stage, 1);
      return Array.from(host.querySelectorAll("p")).find((p) => /refused|back in stock/.test(p.textContent ?? ""))!.className;
    };
    expect(note("delivered")).toContain("text-[var(--tone-critical-text)]");
    expect(note("cancelled")).not.toContain("text-[var(--tone-critical-text)]");
    expect(note("cancelled")).toContain("text-muted-foreground");
  });

  it("says nothing about a line whose units all stayed with the customer", () => {
    for (const stage of ["delivered", "cancelled", "returned"] as const) {
      const text = render(stage, 0);
      expect(text).not.toContain("refused");
      expect(text).not.toContain("back in stock");
    }
  });
});
