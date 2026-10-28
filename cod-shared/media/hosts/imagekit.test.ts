import { describe, expect, it } from "vitest";
import { MediaError } from "../errors";
import { imagekitHost } from "./imagekit";
import { followTicket } from "./testing/browser";
import { fakeImageKit } from "./testing/fake-imagekit";
import { png } from "./testing/files";
import { describeHostContract } from "./testing/host-contract";

const KEYS = { publicKey: "public_test", privateKey: "private_test" };

function setup(folder = "/stores/maysa") {
  const fake = fakeImageKit(KEYS);
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
});
