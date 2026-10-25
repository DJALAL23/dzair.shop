import { describe, expect, it } from "vitest";
import { PREVIOUS_SECRET_SIGNS_FOR_MS, WEBHOOK_URL_MAX, newSigningSecret, previousSecretSignsUntil, readWebhookSettings, signingKey, signingSecretsAt, webhookUrlProblem } from "./webhooks";

describe("an endpoint URL", () => {
  it.each([
    "https://hooks.example.dz/codflow",
    "https://api.boutique.dz:8443/webhooks?token=abc",
    "https://8.8.8.8/hook",
    "https://100.63.255.255/",
    "https://100.128.0.1/",
    "https://172.15.255.255/",
    "https://172.32.0.0/",
    "https://192.0.3.1/",
    "https://192.167.255.255/",
    "https://192.169.0.0/",
    "https://198.17.255.255/",
    "https://198.20.0.0/",
    "https://223.255.255.255/",
    "https://[2606:4700:4700::1111]/",
    "https://[2002:808:808::1]/",
    "https://xn--mgbaam7a8h.xn--lgbbat1ad8j/",
    "https://hooks.example.com./",
  ])("may be %s", (url) => {
    expect(webhookUrlProblem(url)).toBeNull();
  });

  it.each([
    ["not a url", "invalid"],
    ["https://", "invalid"],
    ["http://hooks.example.dz/", "not_https"],
    ["ftp://hooks.example.dz/", "not_https"],
    ["https://user:pass@hooks.example.dz/", "credentials"],
    ["https://user@hooks.example.dz/", "credentials"],
    ["https://localhost/", "private_host"],
    ["https://LOCALHOST./", "private_host"],
    ["https://api.localhost/", "private_host"],
    ["https://intranet/", "private_host"],
    ["https://erp-server/", "private_host"],
    ["https://nas./", "private_host"],
    ["https://hooks..example.dz/", "private_host"],
    ["https://printer.local/", "private_host"],
    ["https://db.internal/", "private_host"],
    ["https://nas.home.arpa/", "private_host"],
    ["https://router.lan/", "private_host"],
    ["https://hooks.test/", "private_host"],
    ["https://0.0.0.0/", "private_host"],
    ["https://10.1.2.3/", "private_host"],
    ["https://100.64.0.1/", "private_host"],
    ["https://100.127.255.255/", "private_host"],
    ["https://127.0.0.1/", "private_host"],
    ["https://127.1/", "private_host"],
    ["https://2130706433/", "private_host"],
    ["https://0x7f.0.0.1/", "private_host"],
    ["https://0177.0.0.1/", "private_host"],
    ["https://169.254.169.254/latest/meta-data", "private_host"],
    ["https://172.16.0.1/", "private_host"],
    ["https://172.31.255.255/", "private_host"],
    ["https://192.0.0.8/", "private_host"],
    ["https://192.0.2.1/", "private_host"],
    ["https://192.88.99.1/", "private_host"],
    ["https://192.168.1.1/", "private_host"],
    ["https://198.18.0.1/", "private_host"],
    ["https://198.19.255.255/", "private_host"],
    ["https://198.51.100.7/", "private_host"],
    ["https://203.0.113.9/", "private_host"],
    ["https://224.0.0.1/", "private_host"],
    ["https://255.255.255.255/", "private_host"],
    ["https://[::]/", "private_host"],
    ["https://[::1]/", "private_host"],
    ["https://[::ffff:127.0.0.1]/", "private_host"],
    ["https://[::ffff:8.8.8.8]/", "private_host"],
    ["https://[64:ff9b::a00:1]/", "private_host"],
    ["https://[fc00::1]/", "private_host"],
    ["https://[fd12:3456::1]/", "private_host"],
    ["https://[fe80::1]/", "private_host"],
    ["https://[febf::1]/", "private_host"],
    ["https://[fec0::1]/", "private_host"],
    ["https://[ff02::1]/", "private_host"],
    ["https://[2001:db8::1]/", "private_host"],
    ["https://[100::1]/", "private_host"],
    ["https://[2002:c0a8:101::1]/", "private_host"],
    ["https://[2002:7f00:1::]/", "private_host"],
  ])("may not be %s (%s)", (url, problem) => {
    expect(webhookUrlProblem(url)).toBe(problem);
  });

  it("may be as long as the limit, and not one character longer", () => {
    const at = (length: number) => `https://hooks.example.dz/${"a".repeat(length - "https://hooks.example.dz/".length)}`;
    expect(webhookUrlProblem(at(WEBHOOK_URL_MAX))).toBeNull();
    expect(webhookUrlProblem(at(WEBHOOK_URL_MAX + 1))).toBe("too_long");
  });
});

describe("a webhook Consumer's settings", () => {
  it("carry its URL, and nothing else is read", () => {
    expect(readWebhookSettings('{"url":"https://hooks.example.dz/","extra":1}')).toEqual({ url: "https://hooks.example.dz/" });
  });

  it("are refused without one", () => {
    expect(() => readWebhookSettings("{}")).toThrow("no URL");
  });
});

describe("a Signing Secret", () => {
  it("is 32 random bytes in base64 after whsec_, and signs with those bytes", () => {
    const secret = newSigningSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(signingKey(secret)).toHaveLength(32);
    expect(newSigningSecret()).not.toBe(secret);
  });

  it("decodes as Standard Webhooks' reference does", () => {
    expect(Buffer.from(signingKey("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")).toString("base64")).toBe("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
    expect(() => signingKey("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")).toThrow("Not a Signing Secret");
  });

  const rotatedAt = "2026-10-25T10:00:00.000Z";
  const rotated = { signingSecret: "whsec_new", previousSigningSecret: "whsec_old", secretRotatedAt: rotatedAt };
  const until = new Date(Date.parse(rotatedAt) + PREVIOUS_SECRET_SIGNS_FOR_MS);

  it("signs alone until it is rotated", () => {
    expect(signingSecretsAt({ signingSecret: "whsec_only", previousSigningSecret: null, secretRotatedAt: null }, new Date(rotatedAt))).toEqual(["whsec_only"]);
    expect(previousSecretSignsUntil(null, null)).toBeNull();
  });

  it("after a rotation, signs beside the previous one for a day, then alone", () => {
    expect(previousSecretSignsUntil(rotatedAt, "whsec_old")).toBe(until.toISOString());
    expect(signingSecretsAt(rotated, new Date(until.getTime() - 1))).toEqual(["whsec_new", "whsec_old"]);
    expect(signingSecretsAt(rotated, until)).toEqual(["whsec_new"]);
  });

  it("must exist on a webhook Consumer", () => {
    expect(() => signingSecretsAt({ signingSecret: null, previousSigningSecret: null, secretRotatedAt: null }, new Date())).toThrow("without a Signing Secret");
  });
});
