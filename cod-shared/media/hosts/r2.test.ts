import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { r2Host, type R2S3Access } from "./r2";
import { followTicket } from "./testing/browser";
import { fakeS3 } from "./testing/fake-s3";
import { png } from "./testing/files";
import { describeHostContract } from "./testing/host-contract";

const ACCESS: R2S3Access = { accountId: "acc", bucket: "store-media", accessKeyId: "AKID", secretAccessKey: "SECRET" };

/** A Miniflare bucket whose next calls can be made to throw, as a binding does when R2 is down. */
async function bucket() {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["MEDIA"] });
  const real = await mf.getR2Bucket("MEDIA");
  let failures = 0;
  const binding = new Proxy(real, {
    get(target, name) {
      const value = Reflect.get(target, name);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("R2 binding was told to fail"));
        }
        return value.apply(target, args);
      };
    },
  }) as unknown as R2Bucket;
  return { binding, real, failNext: (times: number) => (failures = times), dispose: () => mf.dispose() };
}

describeHostContract("R2 through the store's binding", async () => {
  const b = await bucket();
  const host = r2Host({ binding: b.binding });
  return { host, browser: (ticket, file) => followTicket(ticket, file, fetch, host), failNext: b.failNext, dispose: b.dispose };
});

describeHostContract("R2 over S3, as the Cloud reaches it", async () => {
  const s3 = fakeS3(ACCESS);
  const host = r2Host({ s3: ACCESS, fetch: s3.fetch, endpoint: s3.endpoint });
  return {
    host,
    browser: (ticket, file) => followTicket(ticket, file, s3.fetch, host),
    failNext: (times) => s3.failNext(times, 503),
    refuseNext: () => s3.failNext(1, 403),
  };
});

describe("R2's binding", () => {
  it("relays a browser's upload through the store's server and keeps files immutable for caches", async () => {
    const b = await bucket();
    try {
      const host = r2Host({ binding: b.binding });
      expect(await host.ticket({ key: "products/a.png", contentType: "image/png", bytes: 10, expiresAt: new Date() })).toEqual({ kind: "relay" });
      await host.put({ key: "products/a.png", contentType: "image/png", body: png() });
      expect((await b.real.head("products/a.png"))?.httpMetadata).toEqual({ contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" });
    } finally {
      await b.dispose();
    }
  });

  it("deletes a thousand keys a call", async () => {
    const b = await bucket();
    try {
      const host = r2Host({ binding: b.binding });
      const keys = Array.from({ length: 1001 }, (_, i) => ({ key: `products/${i}.png`, hostRef: null }));
      let calls = 0;
      const counting = { ...b.binding, delete: (k: string[]) => (calls++, b.binding.delete(k)) } as unknown as R2Bucket;
      await r2Host({ binding: counting }).delete(keys);
      expect(calls).toBe(2);
      expect(host).toBeDefined();
    } finally {
      await b.dispose();
    }
  });
});

describe("R2 over S3's browser ticket", () => {
  it("is a PUT signed for one key, type and size, refused once expired", async () => {
    const s3 = fakeS3(ACCESS);
    const host = r2Host({ s3: ACCESS, fetch: s3.fetch, endpoint: s3.endpoint });
    const ticket = await host.ticket({ key: "products/a.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    expect(ticket).toMatchObject({ kind: "put", headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
    expect(JSON.stringify(ticket)).not.toContain(ACCESS.secretAccessKey);
    const late = await host.ticket({ key: "products/b.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    s3.advance(61_000);
    expect((await followTicket(late, { key: "products/b.png", body: png(), contentType: "image/png" }, s3.fetch, host)).ok).toBe(false);
  });
});
