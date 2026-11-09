import { describe, it, expect } from "vitest";
import { CARRIER_PROVIDERS, CarrierError, OPTIONAL_MEMBER_CAPABILITY, type CarrierAdapter } from "./contract";
import { buildCarrier, carrierCapabilities, carrierWebhook, mergeProviderConfig, type CarrierCompany } from "./registry";

const companies: Record<string, CarrierCompany> = {
  yalidine: { provider: "yalidine", providerConfig: null, apiToken: "t", apiUserGuid: "id", apiEndpoint: null },
  guepex: { provider: "yalidine", providerConfig: JSON.stringify({ platform: "guepex" }), apiToken: "t", apiUserGuid: "id", apiEndpoint: null },
  zr_express: { provider: "zr_express", providerConfig: null, apiToken: "k", apiUserGuid: "tenant", apiEndpoint: null },
  noest: { provider: "noest", providerConfig: null, apiToken: "t", apiUserGuid: "guid", apiEndpoint: null },
  ecotrack: { provider: "ecotrack", providerConfig: null, apiToken: "t", apiUserGuid: null, apiEndpoint: "https://packers.ecotrack.dz" },
};

const adapters = (): CarrierAdapter[] => Object.values(companies).map(buildCarrier);

function refusal(build: () => unknown): CarrierError {
  try {
    build();
  } catch (error) {
    expect(error).toBeInstanceOf(CarrierError);
    return error as CarrierError;
  }
  throw new Error("expected a refusal");
}

describe("the carrier contract holds for every adapter", () => {
  it("covers every provider", () => {
    expect([...new Set(adapters().map((a) => a.provider))].sort()).toEqual([...CARRIER_PROVIDERS].sort());
  });

  for (const [name, company] of Object.entries(companies)) {
    it(`${name}: an optional member exists exactly when its capability says so`, () => {
      const adapter = buildCarrier(company);
      for (const [member, enabled] of Object.entries(OPTIONAL_MEMBER_CAPABILITY)) {
        const present = (adapter as unknown as Record<string, unknown>)[member] !== undefined;
        expect(present, `${adapter.provider}.${member}`).toBe(enabled(adapter.capabilities));
      }
    });

    it(`${name}: capabilities are coherent`, () => {
      const c = buildCarrier(company).capabilities;
      if (c.history) expect(c.historyBatch).toBeGreaterThanOrEqual(1);
      expect(c.homeDelivery || c.stopDesk).toBe(true);
      expect(c.limits.maxDescription ?? 1).toBeGreaterThan(0);
      // A carrier with no webhook must be pullable, or its parcels would never move.
      if (c.updates === "pull") expect(c.history).toBe(true);
    });
  }
});

describe("a company's capabilities without its credentials", () => {
  for (const [name, company] of Object.entries(companies)) {
    it(`${name}: are exactly what its adapter declares`, () => {
      expect(carrierCapabilities({ provider: company.provider, providerConfig: company.providerConfig })).toEqual(buildCarrier(company).capabilities);
    });
  }

  it("Guepex is pulled, Yalidine pushes", () => {
    expect(carrierCapabilities(companies.guepex)!.updates).toBe("pull");
    expect(carrierCapabilities(companies.yalidine)!.updates).toBe("webhook");
  });

  it("a company with no adapter has none", () => {
    expect(carrierCapabilities({ provider: null, providerConfig: null })).toBeNull();
  });

  it("a provider's webhook reader is its adapter's; pull-only providers have none", () => {
    for (const name of ["yalidine", "zr_express", "noest", "ecotrack"] as const) {
      expect(carrierWebhook(name) ?? undefined).toBe(buildCarrier(companies[name]).webhook);
    }
  });
});

describe("building a company's adapter", () => {
  it("a company with no provider cannot take parcels", () => {
    expect(refusal(() => buildCarrier({ ...companies.noest, provider: null })).kind).toBe("misconfigured");
  });

  it("missing credentials are misconfigured", () => {
    for (const company of [
      { ...companies.yalidine, apiUserGuid: null },
      { ...companies.zr_express, apiToken: "  " },
      { ...companies.ecotrack, apiEndpoint: null },
      { ...companies.noest, apiUserGuid: null },
    ]) {
      expect(refusal(() => buildCarrier(company)).kind).toBe("misconfigured");
    }
  });

  it("stored settings that break the adapter's schema are misconfigured, never ignored", () => {
    const company = { ...companies.yalidine, providerConfig: JSON.stringify({ platform: "maystro" }) };
    expect(refusal(() => buildCarrier(company)).kind).toBe("misconfigured");
  });

  it("a stored setting the adapter no longer has does not stop the company", () => {
    const company = { ...companies.yalidine, providerConfig: JSON.stringify({ platform: "yalidine", retired: "old" }) };
    expect(buildCarrier(company).provider).toBe("yalidine");
  });

  it("reads the platform from the settings: Guepex is pulled, Yalidine pushes", () => {
    expect(buildCarrier(companies.guepex).capabilities.updates).toBe("pull");
    expect(buildCarrier(companies.guepex).webhook).toBeUndefined();
    expect(buildCarrier(companies.yalidine).webhook).toBeDefined();
  });

  it("ZR: the tenant's state names in its settings win over the default workflow", () => {
    const adapter = buildCarrier({
      ...companies.zr_express,
      providerConfig: JSON.stringify({ statusMap: { delivered: ["Livraison effectuée"], progress: ["Au hub"], returned: ["Retourné"] } }),
    });
    expect(adapter.interpret({ vocabulary: "state", value: "Livraison effectuée" })).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(adapter.interpret({ vocabulary: "state", value: "Au hub" })).toEqual({ kind: "progress" });
    expect(adapter.interpret({ vocabulary: "state", value: "Retourné" })).toEqual({ kind: "milestone", milestone: "returned" });
  });
});

describe("saving settings", () => {
  const stored = JSON.stringify({ platform: "guepex", fromWilayaName: "Batna" });
  const merged = (patch: Record<string, unknown>, from: string | null = stored) => {
    const result = mergeProviderConfig("yalidine", from, patch);
    if (!result.ok) throw new Error(result.message);
    return JSON.parse(result.json);
  };

  it("changing one setting keeps every other", () => {
    expect(merged({ fromWilayaName: "Oran" })).toEqual({ platform: "guepex", fromWilayaName: "Oran" });
  });

  it("null removes a setting, which goes back to its default", () => {
    expect(merged({ fromWilayaName: null })).toEqual({ platform: "guepex", fromWilayaName: "Alger" });
  });

  it("saving leaves out a stored setting the adapter no longer has", () => {
    const old = JSON.stringify({ platform: "guepex", fromWilayaName: "Batna", retired: "old" });
    expect(merged({ fromWilayaName: "Oran" }, old)).toEqual({ platform: "guepex", fromWilayaName: "Oran" });
  });

  it("starts from the adapter's defaults", () => {
    expect(merged({}, null)).toEqual({ platform: "yalidine", fromWilayaName: "Alger" });
  });

  it("refuses settings the adapter does not know, naming the problem", () => {
    const result = mergeProviderConfig("yalidine", stored, { platform: "maystro" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("platform");
    expect(mergeProviderConfig("ecotrack", null, { anything: 1 }).ok).toBe(false);
  });
});
