import { describe, expect, it } from "vitest";
import { MediaError } from "../errors";
import { checkImageKitAccount, imagekitHost } from "./imagekit";
import { followTicket } from "./testing/browser";
import { fakeImageKit } from "./testing/fake-imagekit";
import { png } from "./testing/files";
import { describeHostContract } from "./testing/host-contract";

const KEYS = { publicKey: "public_test", privateKey: "private_test" };

function setup(folder = "/stores/maysa", listLag = 0) {
  const fake = fakeImageKit(KEYS, { listLag });
  const host = imagekitHost({ ...KEYS, folder, fetch: fake.fetch, uploadOrigin: fake.uploadOrigin, apiOrigin: fake.apiOrigin });
  return { fake, host };
}

describeHostContract("ImageKit", async () => {
  const { fake, host } = setup();
  return {
    host,
    browser: (ticket, file) => followTicket(ticket, file, fake.fetch, host),
    failNext: (times) => fake.failNext(times, 503),
    refuseNext: () => fake.failNext(1, 401),
  };
});

describeHostContract("ImageKit, its file list catching up late", async () => {
  const { fake, host } = setup("/stores/maysa", 3);
  return {
    host,
    browser: (ticket, file) => followTicket(ticket, file, fake.fetch, host),
    failNext: (times) => fake.failNext(times, 503),
    refuseNext: () => fake.failNext(1, 401),
  };
});

describe("ImageKit's store folder", () => {
  it("keeps each store's keys under its own folder of the account", async () => {
    const { fake, host } = setup("/stores/maysa/");
    await host.put({ key: "products/a.png", contentType: "image/png", body: png() });
    expect([...fake.files.keys()]).toEqual(["/stores/maysa/products/a.png"]);
    const ticket = await host.ticket({ key: "reviews/r1/m1.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    expect(ticket).toMatchObject({ kind: "form", fields: { folder: "/stores/maysa/reviews/r1", fileName: "m1.png", useUniqueFileName: "false", overwriteFile: "false" } });
  });

  it("keeps keys at the account's root when the folder is /", async () => {
    const { fake, host } = setup("/");
    await host.put({ key: "products/a.png", contentType: "image/png", body: png() });
    expect([...fake.files.keys()]).toEqual(["/products/a.png"]);
  });

  it("does not see another store's file at the same key", async () => {
    const { fake } = setup();
    const keys = { ...KEYS, fetch: fake.fetch, uploadOrigin: fake.uploadOrigin, apiOrigin: fake.apiOrigin };
    const maysa = imagekitHost({ ...keys, folder: "/stores/maysa" });
    const other = imagekitHost({ ...keys, folder: "/stores/other" });
    const { hostRef } = await other.put({ key: "products/a.png", contentType: "image/png", body: png() });
    expect(await maysa.confirm("products/a.png", null)).toBeNull();
    expect(await maysa.confirm("products/a.png", hostRef), "a ref to another store's file is not this key's").toBeNull();
  });

  it("refuses to start without its keys or with a folder ImageKit cannot hold", () => {
    for (const config of [
      { ...KEYS, publicKey: "", folder: "/" },
      { ...KEYS, privateKey: "", folder: "/" },
      { ...KEYS, folder: "stores" },
      { ...KEYS, folder: "/stores/../x" },
      { ...KEYS, folder: "/stores/a b" },
    ]) {
      expect(() => imagekitHost(config), JSON.stringify(config)).toThrow(MediaError);
    }
  });
});

describe("ImageKit's browser ticket", () => {
  it("is a one-use token for exactly one file", async () => {
    const { fake, host } = setup();
    const ticket = await host.ticket({ key: "products/b.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    const file = { key: "products/b.png", body: png(), contentType: "image/png" };
    expect((await followTicket(ticket, file, fake.fetch, host)).ok).toBe(true);
    fake.files.clear();
    expect((await followTicket(ticket, file, fake.fetch, host)).ok, "used again").toBe(false);
  });

  it("is refused once expired", async () => {
    const { fake, host } = setup();
    const ticket = await host.ticket({ key: "products/c.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() - 1000) });
    expect((await followTicket(ticket, { key: "products/c.png", body: png(), contentType: "image/png" }, fake.fetch, host)).ok).toBe(false);
  });

  it("never overwrites a file already at its key", async () => {
    const { fake, host } = setup();
    await host.put({ key: "products/d.png", contentType: "image/png", body: png(100) });
    const ticket = await host.ticket({ key: "products/d.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    expect((await followTicket(ticket, { key: "products/d.png", body: png(200), contentType: "image/png" }, fake.fetch, host)).ok).toBe(false);
    expect(fake.files.get("/stores/maysa/products/d.png")?.size).toBe(100);
  });

  it("carries no private key", async () => {
    const { host } = setup();
    const ticket = await host.ticket({ key: "products/e.png", contentType: "image/png", bytes: 256, expiresAt: new Date(Date.now() + 60_000) });
    expect(JSON.stringify(ticket)).not.toContain(KEYS.privateKey);
    if (ticket.kind !== "form") throw new Error("ImageKit tickets are forms");
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)));
    const [header, payload] = ticket.fields.token!.split(".").slice(0, 2).map(decode);
    expect(header).toEqual({ alg: "HS256", typ: "JWT", kid: KEYS.publicKey });
    expect(payload).toMatchObject({ fileName: "e.png", folder: "/stores/maysa/products", checks: '"file.size" <= 256 AND "file.mime" IN ["image/png"]' });
  });
});

describe("ImageKit's deletes", () => {
  it("go a hundred files a call", async () => {
    const { fake, host } = setup();
    const files = [];
    for (let i = 0; i < 205; i++) {
      const key = `products/${i.toString(16).padStart(32, "0")}.png`;
      files.push({ key, hostRef: (await host.put({ key, contentType: "image/png", body: png(16) })).hostRef });
    }
    await host.delete(files);
    expect(fake.files.size).toBe(0);
    expect(fake.calls.get("POST api/v1/files/batch/deleteByFileIds")).toBe(3);
  });

  it("delete the rest of a batch that names a file already gone", async () => {
    const { fake, host } = setup();
    const put = async (name: string) => ({ key: `products/${name}.png`, hostRef: (await host.put({ key: `products/${name}.png`, contentType: "image/png", body: png(16) })).hostRef });
    const gone = await put("gone");
    await host.delete([gone]);
    const kept = [await put("a"), await put("b")];
    await host.delete([kept[0]!, gone, kept[1]!]);
    expect(fake.files.size).toBe(0);
  });

  it("refuse a 404 that names no missing file", async () => {
    const odd = imagekitHost({ ...KEYS, folder: "/stores/maysa", fetch: async () => new Response(JSON.stringify({ message: "?" }), { status: 404 }) });
    await expect(odd.delete([{ key: "products/a.png", hostRef: "f1" }])).rejects.toMatchObject({ reason: "host_refused" });
  });
});

describe("checking an ImageKit account before a store uses it", () => {
  const keys = { publicKey: "public_check", privateKey: "private_check" };
  const setup = () => {
    const fake = fakeImageKit(keys);
    const options = { fetch: fake.fetch, uploadOrigin: fake.uploadOrigin, apiOrigin: fake.apiOrigin, uploadWaitMs: 50 };
    return { fake, check: (account: Partial<Parameters<typeof checkImageKitAccount>[0]> = {}) => checkImageKitAccount({ urlEndpoint: fake.urlEndpoint, ...keys, ...account }, options) };
  };

  it("passes an account whose keys upload and whose URL endpoint serves, and leaves nothing behind", async () => {
    const { fake, check } = setup();
    expect(await check()).toEqual({ ok: true });
    expect(fake.calls.get("GET delivery")).toBe(1);
    expect([...fake.files.keys()]).toEqual([]);
  });

  it("names the private key the API refuses, before uploading anything", async () => {
    const { fake, check } = setup();
    expect(await check({ privateKey: "private_other" })).toEqual({ ok: false, problem: "private_key" });
    expect(fake.calls.get("POST upload/api/v2/files/upload")).toBeUndefined();
  });

  it("names the public key whose upload ImageKit never answers", async () => {
    const { fake, check } = setup();
    expect(await check({ publicKey: "public_other" })).toEqual({ ok: false, problem: "public_key" });
    expect([...fake.files.keys()]).toEqual([]);
  });

  it("names the URL endpoint that does not serve the account's files, and still removes the file", async () => {
    const { fake, check } = setup();
    expect(await check({ urlEndpoint: "https://ik.imagekit.test/another_id" })).toEqual({ ok: false, problem: "url_endpoint" });
    expect([...fake.files.keys()]).toEqual([]);
  });

  it("names a URL endpoint that answers every path with a page, not the image", async () => {
    const { fake } = setup();
    const site = "https://shop.example";
    const fetch = (request: Request) => (request.url.startsWith(`${site}/`) ? Promise.resolve(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })) : fake.fetch(request));
    expect(await checkImageKitAccount({ urlEndpoint: site, ...keys }, { fetch, uploadOrigin: fake.uploadOrigin, apiOrigin: fake.apiOrigin })).toEqual({ ok: false, problem: "url_endpoint" });
  });

  it("accepts a URL endpoint written with a trailing slash", async () => {
    const { fake, check } = setup();
    expect(await check({ urlEndpoint: `${fake.urlEndpoint}/` })).toEqual({ ok: true });
  });

  it("is unavailable, not a wrong key, when ImageKit fails", async () => {
    const { fake, check } = setup();
    fake.failNext(1, 503);
    await expect(check()).rejects.toMatchObject({ reason: "host_unavailable" });
  });
});
