import { describe, expect, it } from "vitest";
import { consumerOwner } from "../../../../cod-shared/apps/catalog";
import { CONSUMER_KINDS } from "./index";
import { META_CAPI_KIND } from "./meta-capi";

describe("every Consumer Kind the store delivers to", () => {
  it("belongs to an App or to the merchant's Integrations", () => {
    const unowned = Object.keys(CONSUMER_KINDS).filter((kind) => consumerOwner(kind) === null);
    expect(unowned).toEqual([]);
  });

  it("gives Meta conversions to the Meta App", () => {
    expect(consumerOwner(META_CAPI_KIND)).toBe("meta");
  });
});
