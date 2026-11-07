/**
 * The Media Library on real D1, everywhere it runs: the store's server
 * (its D1 binding) on ImageKit and on R2, and the Cloud (D1 over HTTP) on
 * ImageKit and on R2 over S3. Every rule holds the same on each.
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { getDb, type StoreDb } from "../db/client";
import { remoteDb, type RemoteExecutor } from "../db/remote";
import { mediaDelivery, type MediaDelivery } from "./delivery";
import { MediaError } from "./errors";
import type { MediaHost } from "./hosts/host";
import { imagekitHost } from "./hosts/imagekit";
import { r2Host } from "./hosts/r2";
import { fakeImageKit } from "./hosts/testing/fake-imagekit";
import { fakeS3 } from "./hosts/testing/fake-s3";
import { jpeg, pdf, png, stream, webm, webp } from "./hosts/testing/files";
import { mediaLibrary, type MediaLibrary, type UploadSend } from "./library";

const DAY = 24 * 60 * 60 * 1000;
const RELAY = "https://store.test/api/media/uploads/";

interface Rig {
  host: MediaHost;
  delivery: MediaDelivery;
  /** A browser following the send instructions of a ticket. */
  send(ticket: { mediaId: string; send: UploadSend }, file: { body: Uint8Array<ArrayBuffer>; contentType: string }, library: MediaLibrary): Promise<{ ok: boolean; hostRef: string | null }>;
  failNext(times: number): void;
  holds(key: string): Promise<boolean>;
  dispose(): Promise<void>;
}

async function formOrPut(send: UploadSend, file: { body: Uint8Array<ArrayBuffer>; contentType: string }, fetcher: (request: Request) => Promise<Response>) {
  if (send.kind === "put") return { ok: (await fetcher(new Request(send.url, { method: "PUT", headers: send.headers, body: file.body as BodyInit }))).ok, hostRef: null };
  if (send.kind !== "form") throw new Error("this host does not relay");
  const form = new FormData();
  for (const [name, value] of Object.entries(send.fields)) form.set(name, value);
  form.set(send.fileField, new Blob([file.body], { type: file.contentType }), send.fields.fileName);
  const response = await fetcher(new Request(send.url, { method: "POST", body: form }));
  return { ok: response.ok, hostRef: response.ok ? ((await response.json()) as { fileId: string }).fileId : null };
}

async function imagekitRig(): Promise<Rig> {
  const keys = { publicKey: "public_test", privateKey: "private_test" };
  const fake = fakeImageKit(keys);
  const host = imagekitHost({ ...keys, folder: "/stores/maysa", fetch: fake.fetch, uploadOrigin: fake.uploadOrigin, apiOrigin: fake.apiOrigin });
  return {
    host,
    delivery: mediaDelivery("imagekit", "https://ik.imagekit.io/wocart/stores/maysa"),
    send: (ticket, file) => formOrPut(ticket.send, file, fake.fetch),
    failNext: (times) => fake.failNext(times, 503),
    holds: async (key) => fake.files.has(`/stores/maysa/${key}`),
    dispose: async () => {},
  };
}

async function r2BindingRig(): Promise<Rig> {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["MEDIA"] });
  const bucket = await mf.getR2Bucket("MEDIA");
  let failures = 0;
  const failing = new Proxy(bucket, {
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
  return {
    host: r2Host({ binding: failing }),
    delivery: mediaDelivery("direct", "http://localhost:8787/media"),
    send: async (ticket, file, library) => {
      if (ticket.send.kind !== "relay") throw new Error("the binding relays");
      expect(ticket.send.url).toBe(`${RELAY}${ticket.mediaId}/content`);
      await library.receive(ticket.mediaId, stream(file.body));
      return { ok: true, hostRef: null };
    },
    failNext: (times) => (failures = times),
    holds: async (key) => (await bucket.head(key)) !== null,
    dispose: () => mf.dispose(),
  };
}

async function r2S3Rig(): Promise<Rig> {
  const access = { accountId: "acc", bucket: "store-media", accessKeyId: "AKID", secretAccessKey: "SECRET" };
  const s3 = fakeS3(access);
  return {
    host: r2Host({ s3: access, fetch: s3.fetch, endpoint: s3.endpoint }),
    delivery: mediaDelivery("cloudflare", "https://media.boutique.dz"),
    send: (ticket, file) => formOrPut(ticket.send, file, s3.fetch),
    failNext: (times) => s3.failNext(times, 503),
    holds: async (key) => s3.objects.has(key),
    dispose: async () => {},
  };
}

/** The D1 HTTP API's `raw` form, played by the test database: value arrays in select order. */
const overHttp =
  (raw: D1Database): RemoteExecutor =>
  async (queries) => {
    const results: Array<{ rows: unknown[][] }> = [];
    for (const query of queries) {
      const statement = raw.prepare(query.sql).bind(...query.params);
      if (query.method === "run") {
        await statement.run();
        results.push({ rows: [] });
      } else {
        results.push({ rows: await statement.raw() });
      }
    }
    return results;
  };

const SETUPS: Array<[string, () => Promise<Rig>, "binding" | "http"]> = [
  ["the store's server on ImageKit", imagekitRig, "binding"],
  ["the store's server on R2", r2BindingRig, "binding"],
  ["the Cloud on ImageKit", imagekitRig, "http"],
  ["the Cloud on R2 over S3", r2S3Rig, "http"],
];

describe.each(SETUPS)("the Media Library, %s", (_name, makeRig, reach) => {
  let d1: TestD1;
  let rig: Rig;
  let db: StoreDb;
  let clock: { at: number };
  let library: MediaLibrary;
  let puts: number;

  const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
  const row = (key: string) => d1.raw.prepare(`SELECT * FROM media WHERE "key" = ?1`).bind(key).first<Record<string, unknown>>();
  const age = (key: string, days: number) => run(`UPDATE media SET created_at = ?2 WHERE "key" = ?1`, key, new Date(clock.at - days * DAY).toISOString());

  async function uploaded(body: Uint8Array<ArrayBuffer>, contentType = "image/png", report: { width?: number; height?: number } = {}) {
    const ticket = await library.requestUpload({ folder: "products", contentType, bytes: body.byteLength });
    const sent = await rig.send(ticket, { body, contentType }, library);
    expect(sent.ok).toBe(true);
    return { ticket, image: await library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef, ...report }) };
  }

  beforeAll(async () => {
    d1 = await createTestD1();
    rig = await makeRig();
    db = reach === "binding" ? getDb(d1.raw) : remoteDb(overHttp(d1.raw));
    await run("INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Boutique', '2026-01-01', '2026-01-01')");
    await run("INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1000, '2026-01-01', '2026-01-01')");
  });
  afterAll(async () => {
    await rig?.dispose();
    await d1?.dispose();
  });
  beforeEach(() => {
    clock = { at: Date.now() };
    puts = 0;
    const counted: MediaHost = { ...rig.host, put: (object) => ((puts += 1), rig.host.put(object)) };
    library = mediaLibrary({ db, host: counted, delivery: rig.delivery, relayUrl: (id) => `${RELAY}${id}/content`, now: () => new Date(clock.at) });
  });

  describe("a browser's upload", () => {
    it("is refused before anything is recorded when its folder, type or size is not allowed", async () => {
      const before = await d1.raw.prepare("SELECT count(*) AS n FROM media").first<{ n: number }>();
      for (const [upload, reason] of [
        [{ folder: "reviews", contentType: "image/png", bytes: 10 }, "folder_refused"],
        [{ folder: "products", contentType: "image/svg+xml", bytes: 10 }, "type_refused"],
        [{ folder: "products", contentType: "audio/webm", bytes: 10 }, "type_refused"],
        [{ folder: "products", contentType: "image/png", bytes: 0 }, "too_large"],
        [{ folder: "products", contentType: "image/png", bytes: 10 * 1024 * 1024 + 1 }, "too_large"],
        [{ folder: "products", contentType: "image/png", bytes: 1.5 }, "too_large"],
      ] as const) {
        await expect(library.requestUpload(upload as never), JSON.stringify(upload)).rejects.toMatchObject({ reason });
      }
      expect(await d1.raw.prepare("SELECT count(*) AS n FROM media").first()).toEqual(before);
    });

    it("is pending until the host confirms it, then ready and shown at the delivery's URL", async () => {
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 300 });
      expect(ticket.key).toMatch(/^products\/[0-9a-f]{32}\.png$/);
      expect(await row(ticket.key)).toMatchObject({ status: "pending", bytes: 300, host: rig.host.kind, kind: "image", content_type: "image/png", ready_at: null });
      await expect(library.completeUpload(ticket.mediaId), "nothing sent yet").rejects.toMatchObject({ reason: "upload_missing" });
      expect(await row(ticket.key)).toMatchObject({ status: "pending" });

      const sent = await rig.send(ticket, { body: png(300), contentType: "image/png" }, library);
      const image = await library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef, width: 1200, height: 900 });
      expect(image).toEqual({ key: ticket.key, url: `${rig.delivery.origin}/${ticket.key}`, width: expect.any(Number), height: expect.any(Number) });
      const ready = await row(ticket.key);
      expect(ready).toMatchObject({ status: "ready", bytes: 300, ready_at: new Date(clock.at).toISOString() });
      if (rig.host.kind === "imagekit") expect(ready).toMatchObject({ host_ref: expect.any(String), width: 640, height: 480 });
      else expect(ready).toMatchObject({ host_ref: null, width: 1200, height: 900 });
    });

    it("is confirmed once, however many times or at once it is completed", async () => {
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 256 });
      const sent = await rig.send(ticket, { body: png(256), contentType: "image/png" }, library);
      const [one, two] = await Promise.all([library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef }), library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef })]);
      expect(two).toEqual(one);
      expect(await library.completeUpload(ticket.mediaId)).toEqual(one);
      expect(await d1.raw.prepare(`SELECT count(*) AS n FROM media WHERE "key" = ?1`).bind(ticket.key).first()).toEqual({ n: 1 });
    });

    it("that is not the ticket's file is deleted with its row, so the browser starts again", async () => {
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 100 });
      await rig.host.put({ key: ticket.key, contentType: "image/png", body: png(5000) });
      await expect(library.completeUpload(ticket.mediaId)).rejects.toMatchObject({ reason: "upload_mismatch" });
      expect(await row(ticket.key)).toBeNull();
      expect(await rig.holds(ticket.key)).toBe(false);
      await expect(library.completeUpload(ticket.mediaId)).rejects.toMatchObject({ reason: "upload_unknown" });
    });

    it("whose bytes are another type than its ticket's never becomes ready", async () => {
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 256 });
      const sent = await rig.send(ticket, { body: jpeg(256), contentType: "image/png" }, library).catch((error: unknown) => error);
      if (sent instanceof MediaError) {
        expect(sent.reason).toBe("type_refused");
        return;
      }
      const result = await library.completeUpload(ticket.mediaId, { hostRef: (sent as { hostRef: string | null }).hostRef }).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(MediaError);
      expect(["upload_mismatch", "upload_missing"]).toContain((result as MediaError).reason);
      expect((await row(ticket.key))?.status ?? null).not.toBe("ready");
    });

    it("of an id no upload has is refused", async () => {
      await expect(library.completeUpload("0".repeat(32))).rejects.toMatchObject({ reason: "upload_unknown" });
    });

    it("waits through a host outage: a failed confirmation keeps it pending, and the retry completes it", async () => {
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 256 });
      const sent = await rig.send(ticket, { body: png(256), contentType: "image/png" }, library);
      rig.failNext(1);
      await expect(library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef })).rejects.toMatchObject({ reason: "host_unavailable", retryable: true });
      expect(await row(ticket.key)).toMatchObject({ status: "pending" });
      expect(await library.completeUpload(ticket.mediaId, { hostRef: sent.hostRef })).toMatchObject({ key: ticket.key });
    });
  });

  describe("a key about to be shown", () => {
    it("is ready, kept by this host; anything else is refused", async () => {
      const { image } = await uploaded(png());
      expect(await library.ready(image.key)).toMatchObject({ key: image.key, status: "ready" });
      const pending = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 10 });
      await expect(library.ready(pending.key)).rejects.toMatchObject({ reason: "not_ready" });
      await expect(library.ready("products/never.png")).rejects.toMatchObject({ reason: "not_ready" });
      await expect(library.ready("https://x.dz/products/a.png")).rejects.toMatchObject({ reason: "key_invalid" });
      await run(`INSERT INTO media (id, "key", host, kind, content_type, status, created_at) VALUES (?1, 'products/other-host.png', ?2, 'image', 'image/png', 'ready', '2026-01-01')`, crypto.randomUUID(), rig.host.kind === "r2" ? "imagekit" : "r2");
      await expect(library.ready("products/other-host.png")).rejects.toMatchObject({ reason: "not_ready" });
    });
  });

  describe("a relayed upload", () => {
    it("is capped at its ticket's size, typed by its bytes, and refused once its ticket has expired", async (context) => {
      const probe = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 100 });
      if (probe.send.kind !== "relay") return context.skip();
      await expect(library.receive(probe.mediaId, stream(png(101)))).rejects.toMatchObject({ reason: "too_large" });
      await expect(library.receive(probe.mediaId, stream(pdf(100)))).rejects.toMatchObject({ reason: "type_refused" });
      await expect(library.receive(probe.mediaId, stream(new Uint8Array()))).rejects.toMatchObject({ reason: "upload_missing" });
      expect(await rig.holds(probe.key)).toBe(false);
      clock.at += 601_000;
      await expect(library.receive(probe.mediaId, stream(png(100)))).rejects.toMatchObject({ reason: "upload_unknown" });
      expect(await rig.holds(probe.key)).toBe(false);
    });
  });

  describe("the server's own writes", () => {
    it("are kept under a fresh key, or the key given, typed by their bytes", async () => {
      const fresh = await library.store({ folder: "landing", contentType: "image/webp", body: webp(400) });
      expect(fresh).toMatchObject({ key: expect.stringMatching(/^landing\/[0-9a-f]{32}\.webp$/), status: "ready", kind: "image", bytes: 400 });
      const voice = await library.store({ key: "reviews/r1/m2.webm", contentType: "audio/webm", body: webm(900) });
      expect(voice).toMatchObject({ key: "reviews/r1/m2.webm", status: "ready", kind: "audio", contentType: "audio/webm", bytes: 900 });
      expect(await rig.holds("reviews/r1/m2.webm")).toBe(true);
    });

    it("are kept once: a key already ready is never written again", async () => {
      await library.store({ key: "products/starter-dress.webp", contentType: "image/webp", body: webp(300) });
      const again = await library.store({ key: "products/starter-dress.webp", contentType: "image/webp", body: webp(999) });
      expect(again.bytes).toBe(300);
      expect(puts).toBe(1);
    });

    it("are refused when the bytes are not their type, the key is not a key, or a fresh key is asked outside a browser folder", async () => {
      await expect(library.store({ key: "products/x.png", contentType: "image/png", body: jpeg() })).rejects.toMatchObject({ reason: "type_refused" });
      await expect(library.store({ key: "products/x.png", contentType: "text/html", body: png() })).rejects.toMatchObject({ reason: "type_refused" });
      await expect(library.store({ key: "../x.png", contentType: "image/png", body: png() })).rejects.toMatchObject({ reason: "key_invalid" });
      await expect(library.store({ folder: "reviews" as never, contentType: "image/png", body: png() })).rejects.toMatchObject({ reason: "folder_refused" });
      expect(puts).toBe(0);
    });

    it("survive a host outage: the row waits pending, and the retry makes it ready", async () => {
      rig.failNext(1);
      await expect(library.store({ key: "reviews/r9/m1.webp", contentType: "image/webp", body: webp() })).rejects.toMatchObject({ reason: "host_unavailable" });
      expect(await row("reviews/r9/m1.webp")).toMatchObject({ status: "pending" });
      expect(await library.store({ key: "reviews/r9/m1.webp", contentType: "image/webp", body: webp() })).toMatchObject({ status: "ready" });
    });
  });

  describe("releasing keys", () => {
    it("deletes only what nothing else shows, from the host and then the row", async () => {
      const shown = (await uploaded(png())).image.key;
      const inTheme = (await uploaded(png())).image.key;
      const unused = (await uploaded(png())).image.key;
      await run("INSERT INTO product_images (id, product_id, media_key, created_at, updated_at) VALUES (?1, 'p1', ?2, '2026-01-01', '2026-01-01')", crypto.randomUUID(), shown);
      await run(`INSERT OR REPLACE INTO store_theme_settings (store_id, theme_key, "values", updated_at) VALUES ('s1', 'theme-00', ?1, '2026-01-01')`, JSON.stringify({ banner: { key: inTheme } }));

      const result = await library.release([shown, inTheme, unused, "not a key", "products/never-stored.png"]);
      expect(result.released).toEqual([unused]);
      expect(result.kept).toEqual([shown, inTheme, "not a key", "products/never-stored.png"]);
      expect(await row(unused)).toBeNull();
      expect(await rig.holds(unused)).toBe(false);
      expect(await rig.holds(shown)).toBe(true);
      expect(await row(inTheme)).toMatchObject({ status: "ready" });
    });

    it("keeps every row when the host cannot delete, and the retry finishes", async () => {
      const key = (await uploaded(png())).image.key;
      rig.failNext(1);
      await expect(library.release([key])).rejects.toMatchObject({ reason: "host_unavailable" });
      expect(await row(key)).not.toBeNull();
      expect(await library.release([key])).toEqual({ released: [key], kept: [] });
      expect(await rig.holds(key)).toBe(false);
    });

    it("leaves another host's files alone", async () => {
      await run(`INSERT INTO media (id, "key", host, kind, content_type, status, created_at) VALUES (?1, 'products/elsewhere.png', ?2, 'image', 'image/png', 'ready', '2026-01-01')`, crypto.randomUUID(), rig.host.kind === "r2" ? "imagekit" : "r2");
      expect(await library.release(["products/elsewhere.png"])).toEqual({ released: [], kept: ["products/elsewhere.png"] });
      expect(await row("products/elsewhere.png")).not.toBeNull();
    });
  });

  describe("the sweep", () => {
    it("forgets uploads never finished after a day and unshown files after 30 days, and reports before it deletes", async () => {
      const abandoned = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 256 });
      await rig.send(abandoned, { body: png(256), contentType: "image/png" }, library);
      const recentAbandoned = await library.requestUpload({ folder: "products", contentType: "image/png", bytes: 256 });
      const oldUnshown = (await uploaded(png())).image.key;
      const oldShown = (await uploaded(png())).image.key;
      const recentUnshown = (await uploaded(png())).image.key;
      await age(abandoned.key, 2);
      await age(recentAbandoned.key, 0.5);
      await age(oldUnshown, 31);
      await age(oldShown, 31);
      await age(recentUnshown, 29);
      await run("INSERT INTO product_categories (id, name, slug, image_key, created_at, updated_at) VALUES (?1, 'Robes', ?1, ?2, '2026-01-01', '2026-01-01')", crypto.randomUUID(), oldShown);

      const report = await library.sweep();
      const orphans = report.orphans.map((orphan) => orphan.key);
      expect(orphans).toEqual(expect.arrayContaining([abandoned.key, oldUnshown]));
      expect(orphans).not.toContain(oldShown);
      expect(orphans).not.toContain(recentUnshown);
      expect(orphans).not.toContain(recentAbandoned.key);
      expect(report).toMatchObject({ dryRun: true, deleted: 0 });
      expect(await rig.holds(abandoned.key)).toBe(true);

      const done = await library.sweep({ dryRun: false });
      expect(done.deleted).toBe(done.orphans.length);
      expect(await row(abandoned.key)).toBeNull();
      expect(await rig.holds(abandoned.key), "an upload never confirmed is found and deleted on the host").toBe(false);
      expect(await rig.holds(oldUnshown)).toBe(false);
      expect(await rig.holds(oldShown)).toBe(true);
      expect(await row(recentAbandoned.key)).toMatchObject({ status: "pending" });
    });
  });

  describe("the store's images", () => {
    it("are listed newest first, a page at a time, ready images of the folder only", async () => {
      await run(`DELETE FROM media WHERE "key" LIKE 'landing/%'`);
      const keys: string[] = [];
      for (let i = 0; i < 5; i++) {
        clock.at += 1000;
        keys.push((await library.store({ folder: "landing", contentType: "image/webp", body: webp() })).key);
      }
      await library.requestUpload({ folder: "landing", contentType: "image/png", bytes: 10 });
      const first = await library.list({ folder: "landing", limit: 2 });
      expect(first.items.map((item) => item.key)).toEqual([keys[4], keys[3]]);
      expect(first.items[0]).toMatchObject({ url: `${rig.delivery.origin}/${keys[4]}` });
      const second = await library.list({ folder: "landing", limit: 2, after: first.next });
      const third = await library.list({ folder: "landing", limit: 2, after: second.next });
      expect([...second.items, ...third.items].map((item) => item.key)).toEqual([keys[2], keys[1], keys[0]]);
      expect(third.next).toBeNull();
    });
  });

  describe("serving", () => {
    it("opens a file only on a host the store's server serves itself", async () => {
      const { key } = await library.store({ key: "products/served.png", contentType: "image/png", body: png(64) });
      const object = await library.open(key);
      if (!rig.host.open) {
        expect(object).toBeNull();
        return;
      }
      expect(object).toMatchObject({ contentType: "image/png", bytes: 64 });
      expect(await library.open("../products/served.png")).toBeNull();
    });

    it("opens only a ready file: never one still uploading", async () => {
      if (!rig.host.open) return;
      const file = webp(256);
      const ticket = await library.requestUpload({ folder: "products", contentType: "image/webp", bytes: file.byteLength });
      expect((await rig.send(ticket, { body: file, contentType: "image/webp" }, library)).ok).toBe(true);
      expect(await library.open(ticket.key)).toBeNull();
      await library.completeUpload(ticket.mediaId, {});
      expect(await library.open(ticket.key)).toMatchObject({ contentType: "image/webp", bytes: 256 });
    });
  });
});
