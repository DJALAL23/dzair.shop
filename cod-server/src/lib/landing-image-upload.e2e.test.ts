/**
 * An AI agent's landing page image on real D1 and the store's own media
 * host — its real (local) bucket, or ImageKit with no bucket at all: fetched
 * or decoded, checked, prepared, kept as `landing/<key>.<ext>`, put on the
 * landing page and audited, all in the call.
 *
 * `fetch` and the Images binding are the only fakes. Proved: the url and
 * bytes paths; a refused, failing, slow, mismatched or oversized image keeps
 * nothing; a page gone before or during the call gets no row, and its file
 * is released; WebP re-encoding, and the original kept whenever it cannot
 * happen; what the audit records; nothing is kept anywhere but the store's
 * host.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_IMAGEKIT, TEST_IMAGEKIT_VARS, TEST_MEDIA_VARS } from "@/test-utils/media";
import { fakeImageKit } from "../../../cod-shared/media/hosts/testing/fake-imagekit";
import * as schema from "@/db/schema";
import { addAgentLandingImage, FETCH_TIMEOUT_MS, LandingImageError, type LandingImageSource } from "./landing-image-upload";

const PNG_1X1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const WEBP_1X1 = new Uint8Array(Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"));

const T = "2026-10-20T08:00:00.000Z";
const PAGE = "6f0c9b8e-3d2a-4e5f-8a7b-9c1d2e3f4a5b";
const ACTOR = { id: "user-1", name: "Ada", role: "staff" as const };
const IMAGE_URL = "https://images.openai.example/generated.png";
const URL_SOURCE: LandingImageSource = { kind: "url", url: IMAGE_URL };

let d1: TestD1;

/** The Images binding: answers with `answer` and counts its calls. */
function imageTransform(answer: () => Promise<Response> | Response) {
  const calls = { count: 0 };
  return {
    calls,
    binding: {
      input: () => ({
        output: async () => {
          calls.count += 1;
          const response = await answer();
          return { response: () => response };
        },
      }),
    },
  };
}

const add = (input: Partial<Parameters<typeof addAgentLandingImage>[1]> = {}, env: Record<string, unknown> = {}) =>
  addAgentLandingImage({ DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS, ...env } as never, {
    landingPageId: PAGE,
    source: URL_SOURCE,
    contentType: "image/png",
    altText: "Hero shot",
    actor: ACTOR,
    ...input,
  });

const respond = (body: Uint8Array | null, init: ResponseInit = {}) => vi.fn(async (..._args: unknown[]) => new Response(body as BodyInit | null, { status: 200, ...init }));
const imageRows = () => d1.db.select().from(schema.landingPageImages).where(eq(schema.landingPageImages.landingPageId, PAGE)).all();
const mediaRows = () => d1.db.select().from(schema.media).all();
const bucketKeys = async () => (await d1.bucket.list()).objects.map((o) => o.key);

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [schema.activityLogs, schema.media, schema.landingPageImages, schema.landingPages, schema.products]) await d1.db.delete(table);
  const listed = await d1.bucket.list();
  if (listed.objects.length) await d1.bucket.delete(listed.objects.map((o) => o.key));
  await d1.db.insert(schema.products).values({ id: "p1", name: "Robe", handle: "robe", price: 1500, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.landingPages).values({ id: PAGE, slug: "lp-abc12345", name: "Zinc page", productId: "p1", createdAt: T, updatedAt: T });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an image from the agent's URL", () => {
  it("is fetched, kept in the store's media under a fresh landing key, put on the page and audited", async () => {
    const fetch = respond(PNG_1X1);
    vi.stubGlobal("fetch", fetch);

    const output = await add();

    expect(fetch.mock.calls[0]![0]).toBe(IMAGE_URL);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "follow", signal: expect.any(AbortSignal) });
    const key = output.key;
    expect(key).toMatch(/^landing\/[a-f0-9]{32}\.png$/);
    expect(await bucketKeys()).toEqual([key]);
    expect(await mediaRows()).toMatchObject([{ key, host: "r2", status: "ready", contentType: "image/png", width: 1, height: 1 }]);
    const [row] = await imageRows();
    expect(row).toMatchObject({ mediaKey: key, source: "ai", altText: "Hero shot", position: 1, width: 1, height: 1 });
    expect(output).toEqual({ imageId: row!.id, key, url: `${TEST_DELIVERY.origin}/${key}`, position: 1, width: 1, height: 1, altText: "Hero shot", converted: false, storedContentType: "image/png" });

    const [audit] = await d1.db.select().from(schema.activityLogs).all();
    expect(audit).toMatchObject({ actorId: "user-1", actorName: "Ada", actorRole: "staff", action: "landing_page.updated", entityType: "landing_page", entityId: PAGE, entityLabel: "Zinc page" });
    expect(JSON.parse(audit!.metadata!)).toEqual({ via: "mcp", action: "image_added", source: "ai", imageId: row!.id, mediaKey: key, uploadKind: "url", byteSize: PNG_1X1.byteLength, storedContentType: "image/png", convertedToWebp: false });
  });

  it("refused by its server (401, 403, 404) is refused with advice, and keeps nothing", async () => {
    for (const status of [401, 403, 404]) {
      vi.stubGlobal("fetch", respond(null, { status }));
      const failure = add();
      await expect(failure).rejects.toBeInstanceOf(LandingImageError);
      await expect(failure).rejects.toThrow("not publicly fetchable");
    }
    expect(await mediaRows()).toEqual([]);
    expect(await imageRows()).toEqual([]);
  });

  it("failing on its server, or not answering in time, is refused with advice to retry", async () => {
    vi.stubGlobal("fetch", respond(null, { status: 503 }));
    await expect(add()).rejects.toThrow("HTTP 503");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
    await expect(add()).rejects.toThrow(`within ${FETCH_TIMEOUT_MS / 1000} seconds`);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network down"))));
    await expect(add()).rejects.toThrow("network down");
    expect(await mediaRows()).toEqual([]);
  });

  it("whose bytes are not the type claimed is refused, and keeps nothing", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    await expect(add({ contentType: "image/jpeg" })).rejects.toThrow("Content mismatch");
    vi.stubGlobal("fetch", respond(new TextEncoder().encode("<svg/>")));
    await expect(add()).rejects.toThrow("not a recognized image");
    expect(await mediaRows()).toEqual([]);
    expect(await bucketKeys()).toEqual([]);
  });

  it("over 8 MB is refused by its declared length, or as soon as its stream passes the cap", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1, { headers: { "content-length": String(9 * 1024 * 1024) } }));
    await expect(add()).rejects.toThrow("8 MB cap");

    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(endless)));
    await expect(add()).rejects.toThrow("8 MB cap");
    expect(pulled).toBeLessThanOrEqual(10);
    expect(await mediaRows()).toEqual([]);
  });

  it("for a page that does not exist is refused before anything is fetched", async () => {
    const fetch = respond(PNG_1X1);
    vi.stubGlobal("fetch", fetch);
    await d1.db.delete(schema.landingPages).where(eq(schema.landingPages.id, PAGE));
    await expect(add()).rejects.toThrow("not found");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("for a page deleted during the call gets no row, and its kept file is released", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      await d1.db.delete(schema.landingPages).where(eq(schema.landingPages.id, PAGE));
      return new Response(PNG_1X1);
    }));
    await expect(add()).rejects.toThrow();
    expect(await imageRows()).toEqual([]);
    expect(await mediaRows()).toEqual([]);
    expect(await bucketKeys()).toEqual([]);
  });

  it("at a position past the end goes last", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    expect((await add({ position: 9 })).position).toBe(1);
  });

  it("at a position goes there, the images from there moving down one", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    await d1.db.insert(schema.landingPageImages).values({ id: "first", landingPageId: PAGE, mediaKey: "landing/first.webp", position: 1, createdAt: T });
    expect((await add({ position: 1 })).position).toBe(1);
    expect((await imageRows()).sort((a, b) => a.position - b.position).map((row) => [row.id === "first", row.position])).toEqual([[false, 1], [true, 2]]);
  });
});

describe("an image the agent sent as bytes", () => {
  it("is kept, put on the page and audited, with nothing fetched", async () => {
    const fetch = respond(PNG_1X1);
    vi.stubGlobal("fetch", fetch);
    const output = await add({ source: { kind: "bytes", bytes: PNG_1X1 } });
    expect(output).toMatchObject({ key: expect.stringMatching(/^landing\/[a-f0-9]{32}\.png$/), width: 1, height: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(await imageRows()).toHaveLength(1);
    expect(await bucketKeys()).toEqual([output.key]);
    const [audit] = await d1.db.select().from(schema.activityLogs).all();
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ uploadKind: "bytes" });
  });

  it("empty or over 8 MB is refused", async () => {
    await expect(add({ source: { kind: "bytes", bytes: new Uint8Array(0) } })).rejects.toThrow("empty");
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG_1X1.subarray(0, 8));
    await expect(add({ source: { kind: "bytes", bytes: big } })).rejects.toThrow("8 MB cap");
    expect(await mediaRows()).toEqual([]);
  });
});

describe("on an ImageKit store", () => {
  it("keeps the image in ImageKit, never in a bucket, and shows it from ImageKit", async () => {
    const imagekit = fakeImageKit(TEST_IMAGEKIT);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host === "images.openai.example") return new Response(PNG_1X1);
      const origin = url.host === "upload.imagekit.io" ? imagekit.uploadOrigin : imagekit.apiOrigin;
      return imagekit.fetch(new Request(`${origin}${url.pathname}${url.search}`, request));
    });

    const output = await addAgentLandingImage({ DB: d1.raw, ...TEST_IMAGEKIT_VARS } as never, { landingPageId: PAGE, source: URL_SOURCE, contentType: "image/png", actor: ACTOR });

    expect([...imagekit.files.keys()]).toEqual([`/stores/maysa/${output.key}`]);
    expect(output.url).toBe(`${TEST_IMAGEKIT_VARS.MEDIA_ORIGIN}/${output.key}`);
    expect(await mediaRows()).toMatchObject([{ key: output.key, host: "imagekit", status: "ready" }]);
    expect(await bucketKeys()).toEqual([]);
  });
});

describe("re-encoding to WebP (the Images binding)", () => {
  it("keeps a PNG as WebP under a .webp key", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    const images = imageTransform(() => new Response(WEBP_1X1));

    const output = await add({}, { IMAGE_TRANSFORM: images.binding });

    expect(images.calls.count).toBe(1);
    expect(output).toMatchObject({ key: expect.stringMatching(/\.webp$/), converted: true, storedContentType: "image/webp", width: 1, height: 1 });
    expect(await mediaRows()).toMatchObject([{ key: output.key, contentType: "image/webp" }]);
    const [audit] = await d1.db.select().from(schema.activityLogs).all();
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ storedContentType: "image/webp", convertedToWebp: true, byteSize: WEBP_1X1.byteLength });
  });

  it("keeps a WebP as it is, without a billed transformation", async () => {
    vi.stubGlobal("fetch", respond(WEBP_1X1));
    const images = imageTransform(() => new Response(WEBP_1X1));

    const output = await add({ contentType: "image/webp" }, { IMAGE_TRANSFORM: images.binding });

    expect(images.calls.count).toBe(0);
    expect(output).toMatchObject({ key: expect.stringMatching(/\.webp$/), converted: true, storedContentType: "image/webp" });
  });

  it("keeps the original when the binding is missing, throws, answers an error or nothing", async () => {
    const answers: Array<Record<string, unknown>> = [
      {},
      { IMAGE_TRANSFORM: imageTransform(() => Promise.reject(new Error("quota"))).binding },
      { IMAGE_TRANSFORM: imageTransform(() => new Response("no", { status: 415 })).binding },
      { IMAGE_TRANSFORM: imageTransform(() => new Response(new Uint8Array(0))).binding },
    ];
    for (const env of answers) {
      vi.stubGlobal("fetch", respond(PNG_1X1));
      const output = await add({}, env);
      expect(output).toMatchObject({ key: expect.stringMatching(/\.png$/), converted: false, storedContentType: "image/png" });
    }
    expect(await imageRows()).toHaveLength(4);
  });
});
