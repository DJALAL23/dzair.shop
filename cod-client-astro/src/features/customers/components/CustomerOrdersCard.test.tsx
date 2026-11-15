// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CustomerOrdersCard } from "./CustomerOrdersCard";

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

it("says which call a customer who does not answer is at, on a phone and on a wide screen", () => {
  const order = { id: "o1", orderNumber: "ORD-1", status: "unreachable", stage: "unreachable", unansweredCalls: 2, price: 3000, createdAt: "2026-11-14T08:00:00.000Z", wilayaId: 16, communeId: null, wilaya: null, commune: null } as const;
  act(() => root.render(<CustomerOrdersCard orders={[order]} locale="en" />));
  expect(host.textContent!.split("No answer · Call 2").length - 1).toBe(2);
});
