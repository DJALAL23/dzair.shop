import { describe, expect, it } from "vitest";
import { GRANT_LIFETIME_SECONDS, issueUploadGrant, readUploadGrant } from "./grant";

const SECRET = "test-secret-for-grants";
const NOW = 1_800_000_000;
const claims = { orderId: "o1", maxPhotos: 3, voiceMaxSeconds: 60 };

describe("an upload grant", () => {
  it("reads back what it was issued with, until it ends", async () => {
    const { token, grant } = await issueUploadGrant(SECRET, claims, NOW);
    expect(grant).toMatchObject({ ...claims, expiresAt: NOW + GRANT_LIFETIME_SECONDS });
    expect(grant.id).toMatch(/^[a-f0-9]{32}$/);
    expect(await readUploadGrant(SECRET, token, NOW + GRANT_LIFETIME_SECONDS - 1)).toEqual(grant);
    expect(await readUploadGrant(SECRET, token, NOW + GRANT_LIFETIME_SECONDS)).toBeNull();
  });

  it("refuses one signed with another secret, or altered in any way", async () => {
    const { token } = await issueUploadGrant(SECRET, claims, NOW);
    expect(await readUploadGrant("another-secret", token, NOW)).toBeNull();
    const [payload, signature] = token.split(".");
    const raised = btoa(JSON.stringify({ ...JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))), maxPhotos: 60 })).replace(/=+$/, "");
    expect(await readUploadGrant(SECRET, `${raised}.${signature}`, NOW)).toBeNull();
    expect(await readUploadGrant(SECRET, `${payload}.${signature.slice(0, -2)}AA`, NOW)).toBeNull();
    for (const junk of ["", ".", "a.b.c", `${payload}.`, "%%%.%%%", "x".repeat(3000)]) expect(await readUploadGrant(SECRET, junk, NOW)).toBeNull();
  });

  it("gives every grant its own folder", async () => {
    const a = await issueUploadGrant(SECRET, claims, NOW);
    const b = await issueUploadGrant(SECRET, claims, NOW);
    expect(a.grant.id).not.toBe(b.grant.id);
  });
});
