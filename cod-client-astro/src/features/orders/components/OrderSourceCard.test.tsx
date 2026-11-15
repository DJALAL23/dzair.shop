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

const sheetSection = (title: string) => [...document.querySelectorAll('[role="dialog"] section')].find((section) => section.querySelector("h3")?.textContent === title)?.textContent ?? "";

async function openDetails() {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("View details"));
  expect(button, "the View details button").toBeTruthy();
  await act(async () => button!.click());
  return document.body.textContent ?? "";
}

describe("where an order came from, on the order page", () => {
  it("shows the Google search a shopper came from before coming back directly as the credited step, then the visit that ordered", async () => {
    const search = visit({ at: ago(2), channel: "organic_search", platform: "google", referrerHost: "www.google.com", landingPath: "/products/robe-qa", landingPageType: "product" });
    const text = await render(attribution({ channel: "organic_search", platform: "google", earlier: search, first: search }));
    expect(text).toContain("www.google.com · 2 days before ordering");
    expect(text).toContain("Google searchCredited");
    expect(text).toContain("Direct visit");
    expect(text).toContain("Ordered · Home page");
    expect(text).not.toContain("just before ordering");
    expect(text).not.toContain("First visit");
    expect(text).not.toContain("Earlier visit");

    const panel = await openDetails();
    const answer = sheetSection("Source");
    expect(answer).toContain("Google search");
    expect(answer).toContain("This is where the shopper came from, 2 days before ordering. They came back directly to order, and coming back directly never takes the credit away.");
    expect(answer).toContain("Product · robe-qa");
    const path = sheetSection("How the shopper got here");
    expect(path).toContain("Direct visit");
    expect(path).toContain("Ordered");
    expect(path).not.toContain("robe-qa");
    expect(panel.indexOf("Google search")).toBeLessThan(panel.indexOf("How the shopper got here"));
    expect(sheetSection("How the source is decided")).toContain("The last ad the shopper clicked, if it was at most 7 days before ordering.");
    expect(sheetSection("How the source is decided")).toContain("the last site or app that brought them, at most 30 days before.");
  });

  it("says plainly why a direct visit is the source when nothing recent brought the shopper", async () => {
    await render(attribution({}));
    await openDetails();
    const answer = sheetSection("Source");
    expect(answer).toContain("Direct visit");
    expect(answer).toContain("No recent ad or other site brought the shopper: they came straight to the store.");
    expect(answer).toContain("Typed the address");
  });

  it("starts the journey with the first visit when it is another visit", async () => {
    const instagram = visit({ at: ago(12), channel: "organic_social", platform: "meta", app: "ig", referrerHost: "l.instagram.com", landingPath: "/lp/robe-ete", landingPageType: "landing" });
    const text = await render(attribution({ first: instagram }));
    expect(text).toContain("Instagram (not an ad)");
    expect(text).toContain("12 days before ordering");
    expect(text).toContain("First visit · l.instagram.com");
    expect(text.indexOf("Instagram (not an ad)")).toBeLessThan(text.indexOf("Direct visitCredited"));

    const panel = await openDetails();
    expect(panel).toContain("Landing page · robe-ete");
  });

  it("shows no journey when the visit that ordered is the source, only the source and its details", async () => {
    const search = visit({ channel: "organic_search", platform: "google", referrerHost: "www.google.com" });
    const text = await render(attribution({ channel: "organic_search", platform: "google", visit: search, first: search }));
    expect(text).toContain("Google search");
    expect(text).toContain("www.google.com");
    expect(text).not.toContain("Credited");
    expect(text).toContain("View details");
  });

  it("names the ad and its placement under an ad the shopper ordered from in the same visit", async () => {
    const at = ago(0);
    const ad = { platform: "meta", app: "ig", clickedAt: at, clickIdType: null, campaignId: "1", campaignName: "Summer", adsetId: null, adId: "3", adName: "Reel 1", placement: "Instagram_Reels", utmSource: "facebook", utmCampaign: "1", landingPath: "/products/robe", landingPageType: "product" };
    const text = await render(attribution({ channel: "paid_social", platform: "meta", app: "ig", ad, visit: visit({ at, channel: "paid_social", platform: "meta", app: "ig" }) }));
    expect(text).toContain("Instagram ad");
    expect(text).toContain("Reel 1 · Instagram · Reels");
    expect(text).not.toContain("Credited");

    await openDetails();
    const answer = sheetSection("Source");
    expect(answer).toContain("Instagram ad");
    expect(answer).toContain("The shopper clicked this ad and ordered in the same visit, so it gets the credit.");
    expect(answer).toContain("Summer");
    expect(document.body.textContent).not.toContain("How the shopper got here");
  });

  it("names a visit from an AI assistant", async () => {
    const chatgpt = visit({ channel: "ai_assistant", platform: "other", referrerHost: "chatgpt.com" });
    const text = await render(attribution({ channel: "ai_assistant", platform: "other", visit: chatgpt }));
    expect(text).toContain("AI assistant");
    expect(text).toContain("chatgpt.com");
  });

  it("says an order entered by the team has no visit, with no details to open", async () => {
    const text = await render(attribution({ method: "entered", channel: "dashboard", platform: "none", visit: null }));
    expect(text).toContain("Added in the dashboard");
    expect(text).not.toContain("View details");
  });

  it("says the source is unknown rather than guess", async () => {
    const text = await render(attribution({ channel: null, visit: null, legacy: true }));
    expect(text).toContain("Source unknown");
    expect(text).not.toContain("View details");
  });
});
