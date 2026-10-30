/**
 * What every Media Host does, as one suite: a host is added by passing it.
 * `browser` plays a shopper's or merchant's browser following a ticket (for a
 * relaying host, the server storing what it received).
 *
 * A file is found by its ref at once. Found by its key alone, it may take the
 * host a moment (ImageKit's list catches up in seconds): those lookups are
 * `eventually` true. The Media Library relies on them only where that holds —
 * a completion the browser sent no ref with, and the sweep of old uploads.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MediaError } from "../../errors";
import type { HostTicket, MediaHost } from "../host";
import { jpeg, png, webp } from "./files";

export interface HostUnderTest {
  host: MediaHost;
  browser(ticket: HostTicket, file: { key: string; body: Uint8Array; contentType: string }): Promise<{ ok: boolean; hostRef: string | null }>;
  /** Make the host's next `times` answers fail as an outage does. */
  failNext(times: number): void;
  /** Make the host's next answer refuse the credentials; absent where there are none (a binding). */
  refuseNext?(): void;
  dispose?(): Promise<void>;
}

const later = () => new Date(Date.now() + 600_000);

/** Asks again until the answer passes, for up to 30 seconds. */
async function eventually<T>(ask: () => Promise<T>, passes: (answer: T) => boolean): Promise<T> {
  const until = Date.now() + 30_000;
  for (;;) {
    const answer = await ask();
    if (passes(answer) || Date.now() > until) return answer;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
let n = 0;
const freshKey = (ext: string) => `products/${(++n).toString(16).padStart(8, "0")}${crypto.randomUUID().replace(/-/g, "").slice(8)}.${ext}`;

export function describeHostContract(name: string, setup: () => Promise<HostUnderTest>) {
  describe(`${name} as a Media Host`, () => {
    let t: HostUnderTest;
    beforeAll(async () => {
      t = await setup();
    });
    afterAll(async () => t?.dispose?.());

    async function upload(key: string, body: Uint8Array, contentType: string, declared = body.byteLength) {
      const ticket = await t.host.ticket({ key, contentType: contentType as "image/png", bytes: declared, expiresAt: later() });
      return { ticket, sent: await t.browser(ticket, { key, body, contentType }) };
    }

    it("holds what a browser sent by ticket, at its key, as it was sent", async () => {
      const key = freshKey("png");
      const { sent } = await upload(key, png(300), "image/png");
      expect(sent.ok).toBe(true);
      const held = await t.host.confirm(key, sent.hostRef);
      expect(held).toMatchObject({ bytes: 300, contentType: "image/png" });
      expect((await t.host.confirm(key, held!.hostRef))?.bytes, "the whole file's size, not what confirming read").toBe(300);
      expect(await eventually(() => t.host.confirm(key, null), (found) => found !== null), "found by its key alone, as a never-confirmed upload is").toMatchObject({ bytes: 300, contentType: "image/png", hostRef: held!.hostRef });
    });

    it("holds nothing at a key no one sent", async () => {
      expect(await t.host.confirm(freshKey("png"), null)).toBeNull();
    });

    it("refuses a browser's file larger than its ticket, and never reports a file as a type its bytes are not", async (context) => {
      const probe = await t.host.ticket({ key: freshKey("png"), contentType: "image/png", bytes: 10, expiresAt: later() });
      if (probe.kind === "relay") return context.skip();
      const big = freshKey("png");
      expect((await upload(big, png(400), "image/png", 300)).sent.ok).toBe(false);
      expect(await t.host.confirm(big, null)).toBeNull();
      const other = freshKey("png");
      const ticket = await t.host.ticket({ key: other, contentType: "image/png", bytes: 300, expiresAt: later() });
      const sent = await t.browser(ticket, { key: other, body: jpeg(300), contentType: "image/png" });
      const held = await t.host.confirm(other, sent.hostRef);
      if (sent.ok) expect(held?.contentType).toBe("image/jpeg");
      else expect(held).toBeNull();
    });

    it("refuses a ticket used for another key", async (context) => {
      const key = freshKey("png");
      const ticket = await t.host.ticket({ key, contentType: "image/png", bytes: 300, expiresAt: later() });
      if (ticket.kind === "relay") return context.skip();
      const elsewhere = freshKey("png");
      const moved: HostTicket = ticket.kind === "form" ? { ...ticket, fields: { ...ticket.fields, fileName: elsewhere.split("/")[1]! } } : { ...ticket, url: ticket.url.replace(key.split("/")[1]!, elsewhere.split("/")[1]!) };
      expect((await t.browser(moved, { key: elsewhere, body: png(300), contentType: "image/png" })).ok).toBe(false);
      expect(await t.host.confirm(elsewhere, null)).toBeNull();
    });

    it("stores the server's own writes, and a second write replaces the first", async () => {
      const key = freshKey("webp");
      const first = await t.host.put({ key, contentType: "image/webp", body: webp(500) });
      expect(first).toMatchObject({ bytes: 500, contentType: "image/webp" });
      const second = await t.host.put({ key, contentType: "image/webp", body: webp(700) });
      expect(second.hostRef, "the same file, written again").toBe(first.hostRef);
      expect(await t.host.confirm(key, second.hostRef)).toMatchObject({ bytes: 700, contentType: "image/webp" });
    });

    it("deletes files by their refs or their keys alone, and a file already gone counts as deleted", async () => {
      const byRef = freshKey("webp");
      const byKey = freshKey("png");
      const ref = (await t.host.put({ key: byRef, contentType: "image/webp", body: webp() })).hostRef;
      await upload(byKey, png(), "image/png");
      await eventually(() => t.host.confirm(byKey, null), (found) => found !== null);
      await t.host.delete([
        { key: byRef, hostRef: ref },
        { key: byKey, hostRef: null },
        { key: freshKey("webp"), hostRef: null },
      ]);
      expect(await t.host.confirm(byRef, ref)).toBeNull();
      expect(await eventually(() => t.host.confirm(byKey, null), (found) => found === null)).toBeNull();
      await t.host.delete([{ key: byRef, hostRef: ref }]);
    });

    it("says an outage is worth retrying, and loses nothing to it", async () => {
      const key = freshKey("webp");
      t.failNext(1);
      const failed = await t.host.put({ key, contentType: "image/webp", body: webp() }).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(MediaError);
      expect(failed).toMatchObject({ reason: "host_unavailable", retryable: true });
      await t.host.put({ key, contentType: "image/webp", body: webp() });
      t.failNext(1);
      await expect(t.host.delete([{ key, hostRef: null }])).rejects.toMatchObject({ reason: "host_unavailable" });
      expect(await eventually(() => t.host.confirm(key, null), (found) => found !== null)).not.toBeNull();
      t.failNext(1);
      await expect(t.host.confirm(key, null)).rejects.toMatchObject({ reason: "host_unavailable" });
    });

    it("says refused credentials are not worth retrying", async (context) => {
      if (!t.refuseNext) return context.skip();
      t.refuseNext();
      await expect(t.host.put({ key: freshKey("webp"), contentType: "image/webp", body: webp() })).rejects.toMatchObject({ reason: "host_refused", retryable: false });
    });

    it("serves its files to the store's server only when it does not deliver them itself", async () => {
      const key = freshKey("png");
      await t.host.put({ key, contentType: "image/png", body: png(128) });
      if (!t.host.open) return;
      const object = await t.host.open(key);
      expect(object).toMatchObject({ contentType: "image/png", bytes: 128 });
      expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(png(128));
      expect(await t.host.open(freshKey("png"))).toBeNull();
    });
  });
}
