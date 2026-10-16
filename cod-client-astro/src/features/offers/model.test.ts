import { describe, expect, it } from "vitest";
import {
  filterOffers,
  formatOfferDate,
  offerErrorMessage,
  offerRuleLabel,
  offerScheduleLabel,
  paginateOffers,
  parseOfferRoute,
  parseOfferStatus,
  parseOfferType,
  sortOffers,
} from "./model";
import type { Offer } from "./types";

const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: "offer-1",
  name: "Buy 2 Get 1",
  status: "active",
  triggerQuantity: 2,
  rewardQuantity: 1,
  discountType: "free",
  startsAt: null,
  endsAt: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  triggerProduct: { id: "prod-1", name: "Chips", handle: "chips" },
  triggerVariant: null,
  rewardProduct: { id: "prod-2", name: "Soda", handle: "soda" },
  rewardVariant: null,
  ...overrides,
});

const t = (key: string) => key;

describe("offers model", () => {
  it("filters by query, status, and discount type", () => {
    const rows = [offer(), offer({ id: "2", name: "Free Ship", status: "inactive", discountType: "free_shipping", triggerProduct: { id: "prod-3", name: "Snacks", handle: "snacks" } })];
    expect(filterOffers(rows, { query: "chips", status: "all", type: "all" }).map((item) => item.id)).toEqual(["offer-1"]);
    expect(filterOffers(rows, { query: "", status: "inactive", type: "all" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterOffers(rows, { query: "", status: "all", type: "free_shipping" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("sorts and paginates offer collections", () => {
    const rows = [offer({ id: "1", name: "Zed" }), offer({ id: "2", name: "Amel" }), offer({ id: "3", name: "Meriem" })];
    expect(sortOffers(rows, "name", "asc").map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(paginateOffers(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });

  it("builds rule and schedule labels", () => {
    expect(offerRuleLabel(offer(), t)).toBe("buy_x_get_y");
    expect(offerRuleLabel(offer({ discountType: "free_shipping", triggerQuantity: 3 }), t)).toBe("buy_x_free_shipping");
    expect(offerScheduleLabel(offer(), "en", t)).toBeNull();
    expect(offerScheduleLabel(offer({ startsAt: "2026-08-26T00:00:00.000Z" }), "en", t)).toBe("schedule_from");
    expect(offerScheduleLabel(offer({ endsAt: "2026-08-30T00:00:00.000Z" }), "en", t)).toBe("schedule_until");
    expect(offerScheduleLabel(offer({ startsAt: "2026-08-26T00:00:00.000Z", endsAt: "2026-08-30T00:00:00.000Z" }), "en", t)).toBe("schedule_range");
  });

  it("parses only valid offer routes and enums", () => {
    expect(parseOfferRoute("/offers")).toEqual({ kind: "list" });
    expect(parseOfferRoute("/offers/new/")).toEqual({ kind: "new" });
    expect(parseOfferRoute("/offers/offer%2F1")).toEqual({ kind: "edit", id: "offer/1" });
    expect(parseOfferRoute("/offers/offer-1/extra")).toEqual({ kind: "unknown" });
    expect(parseOfferStatus("active")).toBe("active");
    expect(parseOfferStatus("bogus")).toBeUndefined();
    expect(parseOfferType("free_shipping")).toBe("free_shipping");
    expect(parseOfferType("bogus")).toBeUndefined();
  });

  it("maps business error codes and formats dates", () => {
    expect(offerErrorMessage({ code: "OFFER_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(offerErrorMessage({ code: "OFFER_EXPIRED" }, t)).toBe("error_expired");
    expect(offerErrorMessage(new Error("boom"), t)).toBe("error_generic");
    expect(formatOfferDate("2026-08-26T00:00:00.000Z", "en")).toBe("8/26/2026");
    expect(formatOfferDate("not-a-date", "en")).toBe("-");
  });
});

import { offerBody } from "./model";
import type { OfferFormValues } from "./types";

const FORM: OfferFormValues = {
  name: " Buy 2 ",
  discountType: "free",
  triggerProductId: "p1",
  triggerVariantId: "",
  triggerQuantity: "2",
  rewardProductId: "p2",
  rewardVariantId: "",
  rewardQuantity: "1",
  startsAt: "",
  endsAt: "",
  status: "active",
};

describe("offer body: a cleared field is sent as null when editing", () => {
  it("clears an emptied start date, end date and variants when editing", () => {
    const body = offerBody(FORM, true);
    expect(body.startsAt).toBeNull();
    expect(body.endsAt).toBeNull();
    expect(body.triggerVariantId).toBeNull();
    expect(body.rewardVariantId).toBeNull();
  });

  it("leaves them out when creating", () => {
    const body = offerBody(FORM, false);
    expect(body.endsAt).toBeUndefined();
    expect(body.triggerVariantId).toBeUndefined();
  });

  it("keeps a filled end date as an ISO string", () => {
    expect(offerBody({ ...FORM, endsAt: "2030-01-01T10:00" }, true).endsAt).toMatch(/^2030-01-01T/);
  });

  it("clears the reward product when an offer becomes free shipping", () => {
    const body = offerBody({ ...FORM, discountType: "free_shipping", rewardVariantId: "v9" }, true);
    expect(body.rewardProductId).toBeNull();
    expect(body.rewardVariantId).toBeNull();
    expect(body.rewardQuantity).toBe(0);
  });

  it("trims the name", () => {
    expect(offerBody(FORM, true).name).toBe("Buy 2");
  });
});
