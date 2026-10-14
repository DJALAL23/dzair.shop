import { describe, it, expect } from "vitest";
import { CARRIER_PROVIDERS, CarrierError, OPTIONAL_MEMBER_CAPABILITY, type CarrierAdapter } from "./contract";
import { buildCarrier, providerOf, type CarrierCompany } from "./registry";

const companies: Record<string, CarrierCompany> = {
  yalidine: { code: "yalidine", apiToken: "t", apiUserGuid: "id", apiEndpoint: null },
  guepex: { code: "guepex", apiToken: "t", apiUserGuid: "id", apiEndpoint: null },
  zr_express: { code: "zr_express", apiToken: "k", apiUserGuid: "tenant", apiEndpoint: null },
  noest: { code: "noest", apiToken: "t", apiUserGuid: "guid", apiEndpoint: null },
  ecotrack: { code: "packers_ecotrack", apiToken: "t", apiUserGuid: null, apiEndpoint: "https://packers.ecotrack.dz" },
};

const adapters = (): CarrierAdapter[] => Object.values(companies).map(buildCarrier);

describe("the carrier contract holds for every adapter", () => {
  it("covers every provider", () => {
    expect([...new Set(adapters().map((a) => a.provider))].sort()).toEqual([...CARRIER_PROVIDERS].sort());
  });

  for (const company of Object.values(companies)) {
    it(`${company.code}: an optional member exists exactly when its capability says so`, () => {
      const adapter = buildCarrier(company);
      for (const [member, enabled] of Object.entries(OPTIONAL_MEMBER_CAPABILITY)) {
        const present = (adapter as unknown as Record<string, unknown>)[member] !== undefined;
        expect(present, `${adapter.provider}.${member}`).toBe(enabled(adapter.capabilities));
      }
    });

    it(`${company.code}: capabilities are coherent`, () => {
      const c = buildCarrier(company).capabilities;
      if (c.history) expect(c.historyBatch).toBeGreaterThanOrEqual(1);
      expect(c.homeDelivery || c.stopDesk).toBe(true);
      expect(c.limits.maxDescription ?? 1).toBeGreaterThan(0);
      // A carrier with no webhook must be pullable, or its parcels would never move.
      if (c.updates === "pull") expect(c.history).toBe(true);
    });
  }
});

describe("which adapter serves a company", () => {
  it("routes every EcoTrack-platform company to the ecotrack adapter", () => {
    expect(providerOf("ecotrack")).toBe("ecotrack");
    expect(providerOf("tnt_ecotrack")).toBe("ecotrack");
    expect(providerOf("yalidine")).toBe("yalidine");
    expect(providerOf("guepex")).toBe("yalidine");
    expect(providerOf("maystro")).toBeNull();
  });

  it("an unknown code or missing credentials are misconfigured", () => {
    const attempts: CarrierCompany[] = [
      { code: "maystro", apiToken: "t", apiUserGuid: null, apiEndpoint: null },
      { ...companies.yalidine, apiUserGuid: null },
      { ...companies.zr_express, apiToken: "  " },
      { ...companies.ecotrack, apiEndpoint: null },
      { ...companies.noest, apiUserGuid: null },
    ];
    for (const company of attempts) {
      try {
        buildCarrier(company);
        throw new Error(`expected ${company.code} to be refused`);
      } catch (error) {
        expect(error).toBeInstanceOf(CarrierError);
        expect((error as CarrierError).kind).toBe("misconfigured");
      }
    }
  });
});

describe("today's settings are read until provider_config lands", () => {
  it("Yalidine: sender wilaya and relay from notes", async () => {
    const adapter = buildCarrier({
      ...companies.yalidine,
      notes: JSON.stringify({ from_wilaya_name: "Batna", proxy_base_url: "https://relay.example", proxy_secret: "s" }),
    });
    expect(adapter.provider).toBe("yalidine");
    expect(() => buildCarrier({ ...companies.yalidine, notes: "free text, not JSON" })).not.toThrow();
  });

  it("a guepex company is the Yalidine adapter on the Guepex platform", () => {
    const guepex = buildCarrier(companies.guepex);
    expect(guepex.provider).toBe("yalidine");
    expect(guepex.capabilities.updates).toBe("pull");
    expect(guepex.webhook).toBeUndefined();
    expect(buildCarrier(companies.yalidine).webhook).toBeDefined();
  });

  it("an invalid relay URL is misconfigured, not silently ignored", () => {
    try {
      buildCarrier({ ...companies.yalidine, notes: JSON.stringify({ proxy_base_url: "not a url" }) });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as CarrierError).kind).toBe("misconfigured");
    }
  });

  it("ZR: an old order-status mapping keeps outcomes and treats the rest as progress", () => {
    const adapter = buildCarrier({
      ...companies.zr_express,
      webhookStatusMapping: JSON.stringify({ delivered: ["Livraison effectuée"], assigned: ["Au hub"], returned: ["Retourné"] }),
    });
    expect(adapter.interpret({ vocabulary: "state", value: "Livraison effectuée" })).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(adapter.interpret({ vocabulary: "state", value: "Au hub" })).toEqual({ kind: "progress" });
    expect(adapter.interpret({ vocabulary: "state", value: "Retourné" })).toEqual({ kind: "milestone", milestone: "returned" });
  });
});
