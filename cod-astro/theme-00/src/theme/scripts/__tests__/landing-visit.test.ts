/**
 * The landing page of the visit, credited to the order placed after it.
 *
 * A shopper who leaves an ad's landing page for a product page or the basket
 * and orders there still came from that landing page; if the credit is lost,
 * the merchant judges the page by fewer orders than it brought.
 */
/// <reference types="vitest/globals" />

import { creditLandingOfThisVisit, landingOfThisVisit, rememberLanding } from "../landing-visit";

function form(value = ""): HTMLFormElement {
  document.body.innerHTML = `<form method="POST"><input type="hidden" name="landingPageSlug" value="${value}" /></form>`;
  return document.querySelector("form")!;
}
const field = (f: HTMLFormElement) => f.querySelector<HTMLInputElement>('input[name="landingPageSlug"]')!.value;

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("the landing page of the visit", () => {
  it("is credited to an order placed on another page after it", () => {
    rememberLanding("summer-promo");
    const f = form();
    creditLandingOfThisVisit(f);
    expect(field(f)).toBe("summer-promo");
  });

  it("is the last landing page the shopper opened", () => {
    rememberLanding("summer-promo");
    rememberLanding("robe-ete");
    expect(landingOfThisVisit()).toBe("robe-ete");
  });

  it("never replaces the landing page a form names itself", () => {
    rememberLanding("summer-promo");
    const f = form("robe-ete");
    creditLandingOfThisVisit(f);
    expect(field(f)).toBe("robe-ete");
  });

  it("leaves the field empty when the visit opened no landing page", () => {
    const f = form();
    creditLandingOfThisVisit(f);
    expect(field(f)).toBe("");
  });

  it("ignores an empty slug", () => {
    rememberLanding("summer-promo");
    rememberLanding("");
    expect(landingOfThisVisit()).toBe("summer-promo");
  });

  it("does nothing for a form without the field, or no form", () => {
    rememberLanding("summer-promo");
    document.body.innerHTML = `<form method="POST"></form>`;
    expect(() => creditLandingOfThisVisit(document.querySelector("form"))).not.toThrow();
    expect(() => creditLandingOfThisVisit(null)).not.toThrow();
  });

  it("loses only the credit when the browser refuses storage", () => {
    rememberLanding("summer-promo");
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => rememberLanding("summer-promo")).not.toThrow();
    const f = form();
    expect(() => creditLandingOfThisVisit(f)).not.toThrow();
    expect(field(f)).toBe("");
  });
});
