// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrderDetail } from "@/features/orders/types";
import { OrderSourceCard } from "./OrderSourceCard";

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
  host.remove();
});

const ORDERED = "2026-11-13T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.parse(ORDERED) - days * DAY).toISOString();

const visit = (over: Record<string, unknown>) => ({ at: ago(0), channel: "direct", platform: "direct", app: null, referrerHost: null, landingPath: "/", landingPageType: "home", utmSource: null, utmMedium: null, utmCampaign: null, ...over });

const attribution = (over: Record<string, unknown>) => ({
  method: "captured",
  channel: "direct",
  platform: "direct",
  app: null,
  legacy: false,
  ad: null,
  visit: visit({}),
  earlier: null,
  first: null,
  firstTouchAt: null,
  ...over,
});

async function render(attr: Record<string, unknown>) {
  const order = { createdAt: ORDERED, attribution: attr } as unknown as OrderDetail;
  await act(async () => root.render(<OrderSourceCard order={order} locale="en" />));
  return host.textContent ?? "";
}

describe("where an order came from, on the order page", () => {
  it("shows the Google search a shopper came from before coming back directly, apart from this visit", async () => {
    const search = visit({ at: ago(2), channel: "organic_search", platform: "google", referrerHost: "www.google.com", landingPath: "/products/robe-qa", landingPageType: "product" });
    const text = await render(attribution({ channel: "organic_search", platform: "google", earlier: search, first: search }));
    expect(text).toContain("Google search");
    expect(text).toContain("2 days before ordering");
    expect(text).toContain("Earlier visit");
    expect(text).toContain("Product · robe-qa");
    expect(text).toContain("This visit");
    expect(text).toContain("Direct visit");
    expect(text).not.toContain("First visit");
  });

  it("shows the first visit when it is not already on the page", async () => {
    const instagram = visit({ at: ago(12), channel: "organic_social", platform: "meta", app: "ig", referrerHost: "l.instagram.com", landingPath: "/lp/robe-ete", landingPageType: "landing" });
    const text = await render(attribution({ first: instagram }));
    expect(text).toContain("First visit");
    expect(text).toContain("Instagram (not an ad)");
    expect(text).toContain("12 days before ordering");
    expect(text).toContain("Landing page · robe-ete");
  });

  it("shows no earlier visit when this visit is the source", async () => {
    const search = visit({ channel: "organic_search", platform: "google", referrerHost: "www.google.com" });
    const text = await render(attribution({ channel: "organic_search", platform: "google", visit: search, first: search }));
    expect(text).not.toContain("Earlier visit");
    expect(text).not.toContain("First visit");
  });

  it("names a visit from an AI assistant", async () => {
    const chatgpt = visit({ channel: "ai_assistant", platform: "other", referrerHost: "chatgpt.com" });
    const text = await render(attribution({ channel: "ai_assistant", platform: "other", visit: chatgpt }));
    expect(text).toContain("AI assistant");
    expect(text).toContain("chatgpt.com");
  });
});
