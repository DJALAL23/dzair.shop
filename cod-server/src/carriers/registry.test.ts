import { describe, it, expect } from "vitest";
import { CARRIER_PROVIDERS, CarrierError, OPTIONAL_MEMBER_CAPABILITY, type CarrierAdapter } from "./contract";
import { buildCarrier, carrierCapabilities, defaultProviderForCode, mergeProviderConfig, type CarrierCompany } from "./registry";

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
    const company = { ...companies.yalidine, providerConfig: JSON.stringify({ proxyBaseUrl: "not a url" }) };
    expect(refusal(() => buildCarrier(company)).kind).toBe("misconfigured");
  });

  it("reads the platform from the settings: Guepex is pulled, Yalidine pushes", () => {
    expect(buildCarrier(companies.guepex).capabilities.updates).toBe("pull");
    expect(buildCarrier(companies.guepex).webhook).toBeUndefined();
    expect(buildCarrier(companies.yalidine).webhook).toBeDefined();
  });

  it("ZR: the old order-status mapping keeps outcomes and treats the rest as progress (until stage 5)", () => {
    const adapter = buildCarrier({
      ...companies.zr_express,
      webhookStatusMapping: JSON.stringify({ delivered: ["Livraison effectuée"], assigned: ["Au hub"], returned: ["Retourné"] }),
    });
    expect(adapter.interpret({ vocabulary: "state", value: "Livraison effectuée" })).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(adapter.interpret({ vocabulary: "state", value: "Au hub" })).toEqual({ kind: "progress" });
    expect(adapter.interpret({ vocabulary: "state", value: "Retourné" })).toEqual({ kind: "milestone", milestone: "returned" });
  });
});

describe("a new company's default provider", () => {
  it("follows the dashboard's preset codes", () => {
    expect(defaultProviderForCode("yalidine")).toBe("yalidine");
    expect(defaultProviderForCode("guepex")).toBe("yalidine");
    expect(defaultProviderForCode("zr_express")).toBe("zr_express");
    expect(defaultProviderForCode("noest")).toBe("noest");
    expect(defaultProviderForCode("ecotrack")).toBe("ecotrack");
    expect(defaultProviderForCode("tnt_ecotrack")).toBe("ecotrack");
    expect(defaultProviderForCode("maystro")).toBeNull();
  });
});

describe("saving settings", () => {
  const stored = JSON.stringify({ platform: "yalidine", fromWilayaName: "Batna", proxyBaseUrl: "https://relay.example", proxySecret: "relay-secret-1234" });
  const merged = (patch: Record<string, unknown>, from: string | null = stored) => {
    const result = mergeProviderConfig("yalidine", from, patch);
    if (!result.ok) throw new Error(result.message);
    return JSON.parse(result.json);
  };

  it("changing one setting keeps every other — the relay survives a new sender wilaya", () => {
    expect(merged({ fromWilayaName: "Oran" })).toEqual({ platform: "yalidine", fromWilayaName: "Oran", proxyBaseUrl: "https://relay.example", proxySecret: "relay-secret-1234" });
  });

  it("a secret sent back masked keeps the stored secret", () => {
    expect(merged({ proxySecret: "••••1234", fromWilayaName: "Oran" }).proxySecret).toBe("relay-secret-1234");
  });

  it("a new secret replaces it; null removes a setting", () => {
    expect(merged({ proxySecret: "new-secret" }).proxySecret).toBe("new-secret");
    expect(merged({ proxyBaseUrl: null, proxySecret: null })).toEqual({ platform: "yalidine", fromWilayaName: "Batna" });
  });

  it("starts from the adapter's defaults", () => {
    expect(merged({}, null)).toEqual({ platform: "yalidine", fromWilayaName: "Alger" });
  });

  it("refuses settings the adapter does not know, naming the problem", () => {
    const result = mergeProviderConfig("yalidine", stored, { proxyBaseUrl: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("proxyBaseUrl");
    expect(mergeProviderConfig("ecotrack", null, { anything: 1 }).ok).toBe(false);
  });
});
