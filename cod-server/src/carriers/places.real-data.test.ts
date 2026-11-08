/**
 * Each carrier's real list of places, as its API answered on 2026-11-08,
 * read through its adapter and matched by the one rule in cod-shared/places.
 * Every place a carrier lists names exactly one commune of ours, inside the
 * wilaya it files it under — on its own map, which is older than the law's.
 * Its rates are joined to those places by the carrier's own ids, as answered
 * the same day (amounts replaced, see each fixture's note).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNES, communeNamed } from "../../../cod-shared/places";
import type { CarrierAdapter, CarrierPlace } from "./contract";
import { NoestCarrier } from "./noest/adapter";
import { YalidineCarrier, yalidineConfigSchema } from "./yalidine/adapter";
import { ZrExpressCarrier, zrConfigSchema } from "./zr_express/adapter";
import zrList from "./test/places/zr_express.json";
import yalidineList from "./test/places/yalidine.json";
import noestList from "./test/places/noest.json";
import zrRates from "./test/places/zr_express-rates.json";
import yalidineFees from "./test/places/yalidine-fees.json";
import noestFees from "./test/places/noest-fees.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** The carrier's API, answering from its recorded list. */
function serve(answer: (url: URL, body: any) => unknown) {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      return json(answer(url, init?.body ? JSON.parse(String(init.body)) : undefined));
    }) as unknown as typeof fetch;
  });
}

function matchAll(places: CarrierPlace[]) {
  const matched = new Map<string, CarrierPlace>();
  const unmatched: CarrierPlace[] = [];
  for (const place of places) {
    const commune = communeNamed(place.wilaya.number, place.commune.name);
    if (!commune || matched.has(commune.id)) unmatched.push(place);
    else matched.set(commune.id, place);
  }
  return { matched, unmatched };
}

const priced = (places: Iterable<CarrierPlace>) => [...places].filter((p) => p.rate.home != null || p.rate.stopDesk != null);

describe("ZR Express's territories", () => {
  serve((url, body) => {
    if (url.pathname.endsWith("/delivery-pricing/rates")) return { rates: zrRates.rates };
    const size = body.pageSize as number;
    const page = body.pageNumber as number;
    return { items: zrList.items.slice((page - 1) * size, page * size), totalPages: Math.ceil(zrList.items.length / size) };
  });
  const carrier = (): CarrierAdapter => new ZrExpressCarrier({ apiKey: "k", tenantId: "t" }, zrConfigSchema.parse({}));

  it("each name one commune of ours, every one of the 1531 it lists", async () => {
    const places = await carrier().places();
    expect(places).toHaveLength(1531);
    const { matched, unmatched } = matchAll(places);
    expect(unmatched).toEqual([]);
    expect(matched.size).toBe(1531);
  });

  it("leave out only the four wilayas ZR does not serve", async () => {
    const { matched } = matchAll(await carrier().places());
    const missing = COMMUNES.filter((c) => !matched.has(c.id));
    expect([...new Set(missing.map((c) => c.wilayaId))].sort((a, b) => a - b)).toEqual([33, 37, 50, 56]);
  });

  it("send Besbes to Ouled Djellal's territory — the pair ZR refused when it went to Biskra's", async () => {
    const { matched } = matchAll(await carrier().places());
    const besbes = matched.get("c-07-007")!;
    expect(besbes.commune.ref).toBe("9c2d90b7-e126-4d6f-9058-a7d8d4908729");
    expect(besbes.wilaya).toMatchObject({ number: 51, name: "Ouled Djellal" });
    expect(besbes.wilaya.ref).not.toBe("796e70df-1102-44da-9582-2da66ead2ba6"); // Biskra
  });

  it("keep a 2026 commune under the wilaya ZR still files it in", async () => {
    const { matched } = matchAll(await carrier().places());
    expect(matched.get("c-03-019")!.wilaya).toMatchObject({ number: 3, name: "Laghouat" }); // Aflou
  });

  it("are priced by ZR's own territory ids: Sétif's 60 communes at their own rates (this account has none for Sétif itself), every other at its wilaya's", async () => {
    const { matched } = matchAll(await carrier().places());
    const places = [...matched.values()];
    expect(priced(places)).toHaveLength(1531);
    const setif = places.filter((p) => p.wilaya.number === 19);
    expect(setif).toHaveLength(60);
    for (const p of setif) expect(p.rate).toEqual({ home: 900, stopDesk: 500, homeReturn: 150, stopDeskReturn: 150 });
    for (const p of places.filter((p) => p.wilaya.number !== 19)) expect(p.rate).toEqual({ home: 1000, stopDesk: 600, homeReturn: 200, stopDeskReturn: 200 });
  });
});

describe("Yalidine's communes", () => {
  serve((url) => {
    if (url.pathname.endsWith("/wilayas/")) return { has_more: false, data: yalidineList.wilayas };
    if (url.pathname.endsWith("/fees/")) return (yalidineFees.fees as Record<string, unknown>)[url.searchParams.get("to_wilaya_id")!];
    const page = Number(url.searchParams.get("page") ?? 1);
    const data = yalidineList.communes.slice((page - 1) * 1000, page * 1000);
    return { has_more: page * 1000 < yalidineList.communes.length, data };
  });
  /** Yalidine's read waits between fees calls; the clock is moved, not waited on. */
  const read = async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const reading = new YalidineCarrier({ apiId: "i", apiToken: "t" }, yalidineConfigSchema.parse({})).places();
      await vi.runAllTimersAsync();
      return await reading;
    } finally {
      vi.useRealTimers();
    }
  };

  it("each name one commune of ours, all 1541", async () => {
    const { matched, unmatched } = matchAll(await read());
    expect(unmatched).toEqual([]);
    expect(matched.size).toBe(1541);
  });

  it("are matched under Yalidine's own placement: El Borma under Touggourt, as law 19-12 has it", async () => {
    const { matched } = matchAll(await read());
    expect(matched.get("c-30-021")!.wilaya.number).toBe(55);
  });

  it("are priced by Yalidine's commune ids from the sender's wilaya, each priced commune at its express rate, its returns free as this account's are", async () => {
    const { matched } = matchAll(await read());
    const withPrice = priced(matched.values());
    expect(withPrice).toHaveLength(1537);
    for (const p of withPrice) expect(p.rate).toEqual({ home: 1000, stopDesk: 600, homeReturn: 0, stopDeskReturn: 0 });
    const unpriced = [...matched.values()].filter((p) => !withPrice.includes(p));
    expect(unpriced.map((p) => [p.wilaya.number, p.commune.name, p.home])).toEqual([
      [50, "Bordj Badji Mokhtar", false],
      [50, "Timiaouine", false],
      [54, "In Guezzam", false],
      [54, "Tin Zaouatine", false],
    ]);
  });
});

describe("NOEST's communes", () => {
  serve((url) => (url.pathname.endsWith("/get/wilayas") ? noestList.wilayas : url.pathname.endsWith("/fees") ? { tarifs: noestFees.tarifs } : noestList.communes));
  const carrier = (): CarrierAdapter => new NoestCarrier({ apiToken: "t", userGuid: "g" });

  it("each name one commune of ours, all 1541", async () => {
    const { matched, unmatched } = matchAll(await carrier().places());
    expect(unmatched).toEqual([]);
    expect(matched.size).toBe(1541);
  });

  it("are matched under NOEST's own placement, even where it differs from the law: Tabelbala under Béchar", async () => {
    const { matched } = matchAll(await carrier().places());
    expect(matched.get("c-08-012")!.wilaya.number).toBe(8);
    expect(matched.get("c-08-012")!.commune.name).toBe("Tabalbala");
  });

  it("are priced at their wilaya's grid by its number, except Bordj Badji Mokhtar and In Guezzam, which NOEST lists no grid for", async () => {
    const { matched } = matchAll(await carrier().places());
    const unpriced = [...matched.values()].filter((p) => p.rate.home == null && p.rate.stopDesk == null);
    expect([...new Set(unpriced.map((p) => p.wilaya.number))].sort((a, b) => a - b)).toEqual([50, 54]);
    for (const p of priced(matched.values())) expect(p.rate).toEqual({ home: 1000, stopDesk: 600, homeReturn: 200, stopDeskReturn: 200 });
  });
});
