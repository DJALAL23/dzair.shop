/**
 * CodLandingPageImageUploadWorkflow on real D1 and the store's real bucket:
 * an agent's image fetched (or read from Staging), checked, prepared, kept in
 * the store's media as `landing/<job>.<ext>`, put on the landing page and
 * audited.
 *
 * The fake step executor runs each callback at once and records step names;
 * `fetch` and the Images binding are the only fakes. Proved: the payload gate;
 * the url and bytes paths; a refused, failing, mismatched or oversized
 * download stores nothing; a page gone mid-flight gets no row; a re-run
 * stores and inserts once; WebP re-encoding, and the original kept whenever
 * it cannot happen; what the audit records.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_MEDIA_VARS } from "@/test-utils/media";
import * as schema from "@/db/schema";
import { CodLandingPageImageUploadParamsSchema, CodLandingPageImageUploadWorkflow } from "./landing-page-image-upload";

const PNG_1X1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const WEBP_1X1 = new Uint8Array(Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"));

const T = "2026-10-20T08:00:00.000Z";
const PAGE = "6f0c9b8e-3d2a-4e5f-8a7b-9c1d2e3f4a5b";
const ACTOR = { id: "user-1", name: "Ada", role: "staff" as const };

let d1: TestD1;
let job: string;

function payload(overrides: Record<string, unknown> = {}) {
  return { kind: "url", landingPageId: PAGE, job, imageUrl: "https://images.openai.example/generated.png", contentType: "image/png", altText: "Hero shot", actor: ACTOR, ...overrides };
}

function bytesPayload(overrides: Record<string, unknown> = {}) {
  return { kind: "bytes", landingPageId: PAGE, job, contentType: "image/png", actor: ACTOR, ...overrides };
}

function fakeStep() {
  const calls: Array<{ name: string; config: unknown }> = [];
  return {
    calls,
    async do(name: string, configOrCallback: unknown, maybeCallback?: unknown) {
      const callback = typeof configOrCallback === "function" ? configOrCallback : maybeCallback;
      calls.push({ name, config: typeof configOrCallback === "function" ? undefined : configOrCallback });
      return (callback as () => unknown)();
    },
  };
}

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

async function run(data: Record<string, unknown>, env: Record<string, unknown> = {}) {
  const workflow = new (CodLandingPageImageUploadWorkflow as unknown as new (ctx: unknown, env: unknown) => CodLandingPageImageUploadWorkflow)(
    {},
    { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS, ...env },
  );
  const step = fakeStep();
  const output = await workflow.run({ payload: data, instanceId: `lpimg-${job}`, timestamp: new Date() } as never, step as never);
  return { output, step };
}

const respond = (body: Uint8Array | null, init: ResponseInit = {}) => vi.fn(async () => new Response(body as BodyInit | null, { status: 200, ...init }));
const imageRows = () => d1.db.select().from(schema.landingPageImages).where(eq(schema.landingPageImages.landingPageId, PAGE)).all();
const mediaRows = () => d1.db.select().from(schema.media).all();
const held = async (key: string) => (await d1.bucket.head(key)) !== null;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  job = crypto.randomUUID().replace(/-/g, "");
  for (const table of [schema.activityLogs, schema.media, schema.landingPageImages, schema.landingPages, schema.products]) await d1.db.delete(table);
  await d1.db.insert(schema.products).values({ id: "p1", name: "Robe", handle: "robe", price: 1500, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.landingPages).values({ id: PAGE, slug: "lp-abc12345", name: "Zinc page", productId: "p1", createdAt: T, updatedAt: T });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the payload gate", () => {
  it("takes a url payload and a bytes payload", () => {
    expect(CodLandingPageImageUploadParamsSchema.safeParse(payload()).success).toBe(true);
    expect(CodLandingPageImageUploadParamsSchema.safeParse(bytesPayload()).success).toBe(true);
  });

  it("refuses a url payload without its URL, unknown fields, and a job that is not 32 hex", () => {
    const { imageUrl: _, ...noUrl } = payload();
    for (const bad of [noUrl, payload({ r2Key: "landing/x.png" }), payload({ job: "../../products/x" }), payload({ job: "A".repeat(32) }), payload({ job: "a".repeat(31) })]) {
      expect(CodLandingPageImageUploadParamsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("refuses a type the store does not keep, a URL that is not http(s), and a malformed actor", () => {
    for (const bad of [payload({ contentType: "image/svg+xml" }), payload({ imageUrl: "file:///etc/passwd" }), payload({ imageUrl: "not a url" }), payload({ actor: { id: "u", name: "A", role: "owner" } })]) {
      expect(CodLandingPageImageUploadParamsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("fails non-retryably before any step on a malformed payload", async () => {
    const step = fakeStep();
    const workflow = new (CodLandingPageImageUploadWorkflow as unknown as new (ctx: unknown, env: unknown) => CodLandingPageImageUploadWorkflow)({}, { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...TEST_MEDIA_VARS });
    await expect(workflow.run({ payload: payload({ job: "nope" }), instanceId: "x", timestamp: new Date() } as never, step as never)).rejects.toBeInstanceOf(NonRetryableError);
    expect(step.calls).toEqual([]);
  });
});

describe("an image from the agent's URL", () => {
  it("is fetched, kept in the store's media, put on the page and audited", async () => {
    const fetch = respond(PNG_1X1);
    vi.stubGlobal("fetch", fetch);

    const { output, step } = await run(payload());

    const key = `landing/${job}.png`;
    expect(fetch).toHaveBeenCalledWith("https://images.openai.example/generated.png", { redirect: "follow" });
    expect(await held(key)).toBe(true);
    expect(await mediaRows()).toMatchObject([{ key, host: "r2", status: "ready", contentType: "image/png", width: 1, height: 1 }]);
    const [row] = await imageRows();
    expect(row).toMatchObject({ mediaKey: key, source: "ai", altText: "Hero shot", position: 1, width: 1, height: 1 });
    expect(output).toEqual({ imageId: row!.id, key, url: `${TEST_DELIVERY.origin}/${key}`, position: 1, width: 1, height: 1, altText: "Hero shot", converted: false, storedContentType: "image/png" });

    const [audit] = await d1.db.select().from(schema.activityLogs).all();
    expect(audit).toMatchObject({ actorId: "user-1", actorName: "Ada", actorRole: "staff", action: "landing_page.updated", entityType: "landing_page", entityId: PAGE, entityLabel: "Zinc page" });
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ via: "mcp", action: "image_added", source: "ai", imageId: row!.id, mediaKey: key, uploadKind: "url", uploadJobId: `lpimg-${job}` });

    expect(step.calls.map((call) => call.name)).toEqual(["prepare-and-store-image", "insert-image-record", "audit-image-added"]);
    expect(step.calls[0]!.config).toEqual({ retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" });
  });

  it("refused by its server (401, 403, 404) fails for good with advice, and stores nothing", async () => {
    for (const status of [401, 403, 404]) {
      vi.stubGlobal("fetch", respond(null, { status }));
      const failure = run(payload());
      await expect(failure).rejects.toBeInstanceOf(NonRetryableError);
      await expect(failure).rejects.toThrow("not publicly fetchable");
    }
    expect(await mediaRows()).toEqual([]);
    expect(await imageRows()).toEqual([]);
  });

  it("failing on its server is retried", async () => {
    vi.stubGlobal("fetch", respond(null, { status: 503 }));
    const failure = run(payload());
    await expect(failure).rejects.toThrow("HTTP 503");
    await expect(failure).rejects.not.toBeInstanceOf(NonRetryableError);
  });

  it("whose bytes are not the type claimed fails for good, and stores nothing", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    await expect(run(payload({ contentType: "image/jpeg" }))).rejects.toThrow("Content mismatch");
    expect(await mediaRows()).toEqual([]);
  });

  it("over 8 MB is refused by its declared length, or as soon as its stream passes the cap", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1, { headers: { "content-length": String(9 * 1024 * 1024) } }));
    await expect(run(payload())).rejects.toThrow("8 MB cap");

    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(endless)));
    await expect(run(payload())).rejects.toThrow("8 MB cap");
    expect(pulled).toBeLessThanOrEqual(10);
    expect(await mediaRows()).toEqual([]);
  });

  it("for a page deleted mid-flight gets no row", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    await d1.db.delete(schema.landingPages).where(eq(schema.landingPages.id, PAGE));
    await expect(run(payload())).rejects.toThrow("no longer exists");
    expect(await imageRows()).toEqual([]);
  });

  it("run again (an engine restart) is kept and put on the page once", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    const first = await run(payload());
    const second = await run(payload());
    expect(second.output).toEqual(first.output);
    expect(await mediaRows()).toHaveLength(1);
    expect(await imageRows()).toHaveLength(1);
  });

  it("at a position past the end goes last", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    expect((await run(payload({ position: 9 }))).output.position).toBe(1);
  });

  it("at a position goes there, the images from there moving down one", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    await d1.db.insert(schema.landingPageImages).values({ id: "first", landingPageId: PAGE, mediaKey: "landing/first.webp", position: 1, createdAt: T });
    expect((await run(payload({ position: 1 }))).output.position).toBe(1);
    expect((await imageRows()).sort((a, b) => a.position - b.position).map((row) => [row.id === "first", row.position])).toEqual([[false, 1], [true, 2]]);
  });
});

describe("an image the agent sent as bytes", () => {
  it("is read from Staging, kept, put on the page, and its staged copy cleared", async () => {
    await d1.bucket.put(`staging/landing/${job}`, PNG_1X1, { httpMetadata: { contentType: "image/png" } });

    const { output, step } = await run(bytesPayload());

    expect(output).toMatchObject({ key: `landing/${job}.png`, width: 1, height: 1 });
    expect(await held(`staging/landing/${job}`)).toBe(false);
    expect(await imageRows()).toHaveLength(1);
    expect(step.calls.map((call) => call.name)).toEqual(["prepare-and-store-image", "insert-image-record", "clear-staging", "audit-image-added"]);
  });

  it("gone from Staging fails for good", async () => {
    await expect(run(bytesPayload())).rejects.toThrow("staged image is gone");
    expect(await mediaRows()).toEqual([]);
  });
});

describe("re-encoding to WebP (the Images binding)", () => {
  it("keeps a PNG as WebP under a .webp key", async () => {
    vi.stubGlobal("fetch", respond(PNG_1X1));
    const images = imageTransform(() => new Response(WEBP_1X1));

    const { output } = await run(payload(), { IMAGE_TRANSFORM: images.binding });

    expect(images.calls.count).toBe(1);
    expect(output).toMatchObject({ key: `landing/${job}.webp`, converted: true, storedContentType: "image/webp", width: 1, height: 1 });
    expect(await mediaRows()).toMatchObject([{ key: `landing/${job}.webp`, contentType: "image/webp" }]);
    const [audit] = await d1.db.select().from(schema.activityLogs).all();
    expect(JSON.parse(audit!.metadata!)).toMatchObject({ storedContentType: "image/webp", convertedToWebp: true, byteSize: WEBP_1X1.byteLength });
  });

  it("keeps a WebP as it is, without a billed transformation", async () => {
    vi.stubGlobal("fetch", respond(WEBP_1X1));
    const images = imageTransform(() => new Response(WEBP_1X1));

    const { output } = await run(payload({ contentType: "image/webp" }), { IMAGE_TRANSFORM: images.binding });

    expect(images.calls.count).toBe(0);
    expect(output).toMatchObject({ key: `landing/${job}.webp`, converted: true, storedContentType: "image/webp" });
  });

  it("keeps the original when the binding is missing, throws, answers an error or nothing", async () => {
    const answers: Array<Record<string, unknown>> = [
      {},
      { IMAGE_TRANSFORM: imageTransform(() => Promise.reject(new Error("quota"))).binding },
      { IMAGE_TRANSFORM: imageTransform(() => new Response("no", { status: 415 })).binding },
      { IMAGE_TRANSFORM: imageTransform(() => new Response(new Uint8Array(0))).binding },
    ];
    for (const env of answers) {
      job = crypto.randomUUID().replace(/-/g, "");
      vi.stubGlobal("fetch", respond(PNG_1X1));
      const { output } = await run(payload(), env);
      expect(output).toMatchObject({ key: `landing/${job}.png`, converted: false, storedContentType: "image/png" });
    }
    expect(await imageRows()).toHaveLength(4);
  });
});
