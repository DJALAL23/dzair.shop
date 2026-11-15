import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { TOUCH_PARAMS } from "./model";
import { parseCapturedTouches, parseTouch } from "./touch";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const AT = "2026-11-10T09:30:00.000Z";

const AD_TOUCH = {
  at: AT,
  params: {
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "120200000000000001",
    utm_term: "120200000000000002",
    utm_content: "120200000000000003",
    wc_cn: "Robe été",
    wc_an: "Vidéo 1",
    wc_pl: "Facebook_Mobile_Feed",
    wc_ss: "fb",
    fbclid: "IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk",
  },
  path: "/lp/robe-ete",
  ref: "l.facebook.com",
};

describe("parseTouch", () => {
  it("keeps an ad touch as Meta's URL template fills it", () => {
    expect(parseTouch(AD_TOUCH, NOW)).toEqual(AD_TOUCH);
  });

  it("keeps only the touch parameters, never another key of the URL", () => {
    const touch = parseTouch({ at: AT, params: { utm_source: "tiktok", email: "a@b.dz", phone: "0551234567", __proto__: { x: 1 } } }, NOW);
    expect(touch?.params).toEqual({ utm_source: "tiktok" });
  });

  it("trims a value and drops one that is empty, too long or carries a control character", () => {
    const touch = parseTouch(
      { at: AT, params: { utm_source: "  google ", utm_medium: "   ", utm_campaign: "x".repeat(256), utm_term: "a\nb", utm_content: "x".repeat(255) } },
      NOW,
    );
    expect(touch?.params).toEqual({ utm_source: "google", utm_content: "x".repeat(255) });
  });

  it("keeps a click id byte for byte, and drops one Meta could not have made", () => {
    expect(parseTouch({ at: AT, params: { fbclid: "IwAR2F4_Ab-c.D" } }, NOW)?.params).toEqual({ fbclid: "IwAR2F4_Ab-c.D" });
    for (const fbclid of ["IwAR 2F4", "IwAR<script>", "", "x".repeat(1001), 42]) {
      expect(parseTouch({ at: AT, params: { fbclid }, path: "/" }, NOW)?.params, String(fbclid)).toEqual({});
    }
    expect(parseTouch({ at: AT, params: { ttclid: "E.C.P." + "x".repeat(994) } }, NOW)?.params.ttclid).toHaveLength(1000);
    expect(parseTouch({ at: AT, params: { gbraid: "0AAAAA-x_y", wbraid: "Cj0KCQ" } }, NOW)?.params).toEqual({ gbraid: "0AAAAA-x_y", wbraid: "Cj0KCQ" });
    expect(parseTouch({ at: AT, params: { wbraid: "a b" }, path: "/" }, NOW)?.params).toEqual({});
    expect(parseTouch({ at: AT, params: { fbclid: " IwAR2F4 " } }, NOW)?.params).toEqual({ fbclid: "IwAR2F4" });
  });

  it("keeps the pathname alone, and drops what is not a path on the store", () => {
    expect(parseTouch({ at: AT, path: "/products/robe?utm_source=x#top" }, NOW)?.path).toBe("/products/robe");
    for (const path of ["https://evil.example/x", "//evil.example/x", "products/robe", `/${"a".repeat(512)}`, 7]) {
      expect(parseTouch({ at: AT, path, ref: "google.com" }, NOW)?.path, String(path)).toBeNull();
    }
    expect(parseTouch({ at: AT, path: `/${"a".repeat(511)}` }, NOW)?.path).toHaveLength(512);
  });

  it("keeps a referrer host in lower case, and drops anything that is not a host", () => {
    expect(parseTouch({ at: AT, ref: "L.Facebook.COM" }, NOW)?.ref).toBe("l.facebook.com");
    for (const ref of ["https://google.com", "google.com/search", "-bad.com", "bad-.com", "a..b", "a b.com", ""]) {
      expect(parseTouch({ at: AT, ref, path: "/" }, NOW)?.ref, ref).toBeNull();
    }
  });

  it("needs a time in the last 180 days, allowing five minutes of clock skew", () => {
    expect(parseTouch({ ...AD_TOUCH, at: "2026-11-11T12:04:59.000Z" }, NOW)).not.toBeNull();
    expect(parseTouch({ ...AD_TOUCH, at: "2026-11-11T12:05:01.000Z" }, NOW)).toBeNull();
    expect(parseTouch({ ...AD_TOUCH, at: "2026-05-15T12:00:00.000Z" }, NOW)).not.toBeNull();
    expect(parseTouch({ ...AD_TOUCH, at: "2026-05-15T11:59:59.000Z" }, NOW)).toBeNull();
    for (const at of ["2026-11-10", "2026-11-10T09:30:00+01:00", "yesterday", "2026-13-40T99:99:99.000Z", 1731229800000, undefined]) {
      expect(parseTouch({ ...AD_TOUCH, at }, NOW), String(at)).toBeNull();
    }
  });

  it("normalises the time to milliseconds", () => {
    expect(parseTouch({ ...AD_TOUCH, at: "2026-11-10T09:30:00Z" }, NOW)?.at).toBe(AT);
  });

  it("answers null for a touch with nothing to credit, or that is not an object", () => {
    expect(parseTouch({ at: AT }, NOW)).toBeNull();
    expect(parseTouch({ at: AT, params: { email: "a@b.dz" }, path: "nope" }, NOW)).toBeNull();
    for (const raw of [null, undefined, "touch", 1, [AD_TOUCH]]) expect(parseTouch(raw, NOW)).toBeNull();
  });

  it("never throws, whatever it is sent", () => {
    fc.assert(
      fc.property(fc.anything(), fc.record({ at: fc.anything(), params: fc.dictionary(fc.constantFrom(...TOUCH_PARAMS, "x"), fc.anything()), path: fc.anything(), ref: fc.anything() }), (any, shaped) => {
        parseTouch(any, NOW);
        parseTouch(shaped, NOW);
        return true;
      }),
    );
  });
});

describe("parseCapturedTouches", () => {
  const FIRST = { at: "2026-11-01T08:00:00.000Z", params: {}, path: "/", ref: "google.com" };

  const DIRECT = { at: "2026-11-11T11:00:00.000Z", params: {}, path: "/products/robe", ref: null };

  it("reads the three touches, from an object or its JSON", () => {
    const expected = { first: FIRST, last: AD_TOUCH, source: null, visit: DIRECT };
    expect(parseCapturedTouches({ first: FIRST, last: AD_TOUCH, source: null, visit: DIRECT }, NOW)).toEqual(expected);
    expect(parseCapturedTouches(JSON.stringify({ first: FIRST, last: AD_TOUCH, source: null, visit: DIRECT }), NOW)).toEqual(expected);
  });

  it("drops a last touch that is not an ad click: a referrer, or a bare fbclid Meta adds to every link", () => {
    expect(parseCapturedTouches({ first: FIRST, last: FIRST }, NOW)).toEqual({ first: FIRST, last: null, source: null, visit: null });
    const facebookLink = { at: AT, params: { fbclid: "IwAR2F4" }, path: "/", ref: "l.facebook.com" };
    expect(parseCapturedTouches({ last: facebookLink, visit: facebookLink }, NOW)).toEqual({ first: null, last: null, source: null, visit: facebookLink });
  });

  it("reads the last source, and drops one that is direct or an ad, since it is neither", () => {
    const SEARCH = { at: "2026-11-09T10:00:00.000Z", params: {}, path: "/", ref: "www.google.com" };
    expect(parseCapturedTouches({ source: SEARCH, visit: DIRECT }, NOW)).toEqual({ first: null, last: null, source: SEARCH, visit: DIRECT });
    expect(parseCapturedTouches({ source: DIRECT, visit: DIRECT }, NOW)).toEqual({ first: null, last: null, source: null, visit: DIRECT });
    expect(parseCapturedTouches({ source: AD_TOUCH, visit: DIRECT }, NOW)).toEqual({ first: null, last: null, source: null, visit: DIRECT });
    expect(parseCapturedTouches({ source: SEARCH }, NOW)).toEqual({ first: null, last: null, source: SEARCH, visit: null });
  });

  it("keeps a direct visit: a landing page with no parameter and no referrer", () => {
    expect(parseCapturedTouches({ visit: DIRECT }, NOW)).toEqual({ first: null, last: null, source: null, visit: DIRECT });
  });

  it("keeps any touch alone", () => {
    expect(parseCapturedTouches({ last: AD_TOUCH }, NOW)).toEqual({ first: null, last: AD_TOUCH, source: null, visit: null });
    expect(parseCapturedTouches({ first: FIRST }, NOW)).toEqual({ first: FIRST, last: null, source: null, visit: null });
  });

  it("answers null when nothing usable is in it", () => {
    for (const raw of [undefined, null, "", "{", "[]", "null", JSON.stringify({ first: { at: AT } }), {}, { first: "x", last: 3 }, 12]) {
      expect(parseCapturedTouches(raw, NOW), String(raw)).toBeNull();
    }
  });

  it("refuses a JSON string past 12,000 characters without parsing it", () => {
    const padded = JSON.stringify({ first: FIRST, pad: "x".repeat(12000) });
    expect(parseCapturedTouches(padded, NOW)).toBeNull();
    const fits = JSON.stringify({ first: FIRST, pad: "x".repeat(12000 - JSON.stringify({ first: FIRST, pad: "" }).length) });
    expect(fits).toHaveLength(12000);
    expect(parseCapturedTouches(fits, NOW)).toEqual({ first: FIRST, last: null, source: null, visit: null });
  });
});
