import { describe, expect, it, vi } from "vitest";
import { staging, stagingKey } from "./staging";

function recordingBucket() {
  const calls: string[] = [];
  const bucket = new Proxy({} as R2Bucket, {
    get: (_, name) => vi.fn(async () => {
      calls.push(String(name));
      return name === "list" ? { objects: [], truncated: false } : null;
    }),
  });
  return { bucket, calls };
}

describe("Staging", () => {
  it("names its keys under staging/, by area", () => {
    expect(stagingKey("landing", "a".repeat(32))).toBe(`staging/landing/${"a".repeat(32)}`);
    expect(stagingKey("reviews", "g", "u")).toBe("staging/reviews/g/u");
  });

  it("reaches its own keys", async () => {
    const { bucket, calls } = recordingBucket();
    const area = staging(bucket);
    await area.put("staging/landing/x", new Uint8Array([1]), { contentType: "image/png" });
    await area.read("staging/landing/x");
    await area.head("staging/landing/x");
    await area.list("staging/reviews/g/");
    await area.delete(["staging/landing/x"]);
    expect(calls).toEqual(["put", "get", "head", "list", "delete"]);
  });

  it("never reaches a file the store keeps", async () => {
    const { bucket, calls } = recordingBucket();
    const area = staging(bucket);
    const kept = "products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp";
    await expect(area.put(kept, new Uint8Array([1]), { contentType: "image/webp" })).rejects.toThrow("Not a Staging key");
    await expect(area.read(kept)).rejects.toThrow("Not a Staging key");
    await expect(area.head(kept)).rejects.toThrow("Not a Staging key");
    await expect(area.list("products/")).rejects.toThrow("Not a Staging key");
    await expect(area.list("")).rejects.toThrow("Not a Staging key");
    await expect(area.delete(["staging/landing/x", kept])).rejects.toThrow("Not a Staging key");
    expect(calls).toEqual([]);
  });

  it("deletes nothing when given nothing", async () => {
    const { bucket, calls } = recordingBucket();
    await staging(bucket).delete([]);
    expect(calls).toEqual([]);
  });
});
