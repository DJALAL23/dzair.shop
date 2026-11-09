import { describe, expect, it } from "vitest";
import type { Facts } from "./conditions";
import { attemptSignals } from "./facts";
import { appSourceOf, blockListValue, readCheckoutSignals, readNetworkSignals } from "./signals";

const DEVICE = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const context = (value: unknown) => JSON.stringify(value);
const network = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("what a checkout says about itself", () => {
  it("reads all of it", () => {
    expect(readCheckoutSignals(context({ d: DEVICE, f: 4500, s: "meta" }))).toEqual({ deviceKey: DEVICE, fillSeconds: 4.5, visitSource: "meta" });
  });

  it("compares device keys in one case", () => {
    expect(readCheckoutSignals(context({ d: DEVICE.toUpperCase() })).deviceKey).toBe(DEVICE);
  });

  it("keeps what it understands and drops the rest", () => {
    expect(readCheckoutSignals(context({ d: "not-a-key", f: 1000, s: "radio" }))).toEqual({ fillSeconds: 1 });
    expect(readCheckoutSignals(context({ d: DEVICE, f: "fast", s: "tiktok" }))).toEqual({ deviceKey: DEVICE, visitSource: "tiktok" });
  });

  it.each([
    ["negative", -1],
    ["a fraction", 1.5],
    ["over an hour", 3_600_001],
  ])("takes no fill time when it is %s", (_name, f) => {
    expect(readCheckoutSignals(context({ f }))).toEqual({});
  });

  it("takes a fill time of zero and of exactly an hour", () => {
    expect(readCheckoutSignals(context({ f: 0 }))).toEqual({ fillSeconds: 0 });
    expect(readCheckoutSignals(context({ f: 3_600_000 }))).toEqual({ fillSeconds: 3600 });
  });

  it.each([[undefined], [""], ["not json"], ["[1]"], ["null"], ["7"], [context({ d: DEVICE, f: 1000, s: "meta", pad: "x".repeat(600) })]])("knows nothing from %j", (raw) => {
    expect(readCheckoutSignals(raw)).toEqual({});
  });
});

describe("where the visitor connects from", () => {
  it("reads the country in capitals and the company", () => {
    expect(readNetworkSignals(network({ c: "dz", o: "  Algérie Télécom " }))).toEqual({ networkCountry: "DZ", networkOperator: "Algérie Télécom" });
  });

  it("takes the codes the host uses for no country", () => {
    expect(readNetworkSignals(network({ c: "T1" }))).toEqual({ networkCountry: "T1" });
  });

  it("cuts a long company name", () => {
    expect(readNetworkSignals(network({ o: "O".repeat(150) })).networkOperator).toHaveLength(100);
  });

  it("drops what it cannot use", () => {
    expect(readNetworkSignals(network({ c: "Algeria", o: "   " }))).toEqual({});
    expect(readNetworkSignals(network({ c: 12, o: 7 }))).toEqual({});
  });

  it.each([[undefined], [""], ["%E0%A4%A"], ["{broken"], [encodeURIComponent("[1]")], [network({ c: "DZ", pad: "x".repeat(600) })], ["null"]])("knows nothing from %j", (raw) => {
    expect(readNetworkSignals(raw)).toEqual({});
  });
});

describe("the app a store was opened in", () => {
  it.each([
    ["Facebook on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]", "facebook"],
    ["Facebook on Android", "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/441.0.0.33.113;]", "facebook"],
    ["Instagram on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111 (iPhone14,5; iOS 17_1; en_US; en; scale=3.00; 1170x2532; 532394441)", "instagram"],
    ["Instagram on Android", "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.111 Mobile Safari/537.36 Instagram 306.0.0.35.109 Android (33/13; 480dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 529083166)", "instagram"],
    ["TikTok on Android", "Mozilla/5.0 (Linux; Android 12; SM-A125F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.153 Mobile Safari/537.36 trill_2023009050 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/30.9.5 ByteLocale/en BytedanceWebview/d8a21c6", "tiktok"],
    ["TikTok on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_30.8.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US", "tiktok"],
    ["Chrome on Android", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "browser"],
    ["Safari on iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1", "browser"],
  ])("%s", (_name, userAgent, app) => {
    expect(appSourceOf(userAgent)).toBe(app);
  });

  it("says nothing without a User-Agent", () => {
    expect(appSourceOf(undefined)).toBeUndefined();
    expect(appSourceOf("")).toBeUndefined();
  });
});

describe("Block List values", () => {
  it("reads a phone and a network", () => {
    expect(blockListValue("phone", "+213 551234567".replace(" ", ""))).toBe("0551234567");
    expect(blockListValue("ip", " 41.100.1.1 ")).toBe("41.100.1.1");
  });

  it("refuses what is neither", () => {
    expect(blockListValue("phone", "abc")).toBeNull();
    expect(blockListValue("ip", "abc")).toBeNull();
  });
});

describe("the Signals kept beside an attempt", () => {
  const base: Facts = { phone: "0551234567", name: "A", wilayaId: 16, productIds: [], pieces: 1, deliveryType: "home", ipKey: "41.100.1.1", deviceKey: "d" };

  it("keeps a form filled in no time, and nothing that identifies the shopper", () => {
    expect(attemptSignals({ ...base, fillSeconds: 0 })).toEqual({ fillSeconds: 0 });
  });

  it("is empty when nothing is known", () => {
    expect(attemptSignals(base)).toEqual({});
  });
});
