/**
 * A browser's upload through the real /api/media routes on real D1, and the
 * store's own files served at /media/:key — on the R2 host (the store's
 * bucket, uploads relayed through the server) and on ImageKit (the browser
 * posts the form ticket to ImageKit; a fake ImageKit that verifies the
 * ticket's JWT, as the real one does, answers).
 *
 * Proved: the three steps end with a ready image at the store's URL; a
 * relayed file is held to its ticket's type and size; an unknown upload is
 * 404, one never sent is 409; the media configuration missing is
 * MEDIA_NOT_CONFIGURED; uploads need products:manage; /media/:key serves only
 * ready files of a store whose server serves its own, cached as immutable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { signIn } from "@/test-utils/sign-in";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { TEST_DELIVERY, TEST_MEDIA_VARS } from "@/test-utils/media";
import * as schema from "@/db/schema";
import { fakeImageKit } from "../../../../cod-shared/media/hosts/testing/fake-imagekit";
import { jpeg, pdf, png, webp } from "../../../../cod-shared/media/hosts/testing/files";
import { serveRouter, uploadsRouter } from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const IMAGEKIT = { publicKey: "public_test", privateKey: "private_test" };
const IMAGEKIT_VARS = {
  MEDIA_HOST: "imagekit",
  MEDIA_DELIVERY: "imagekit",
  MEDIA_ORIGIN: "https://ik.imagekit.io/wocart/stores/maysa",
  IMAGEKIT_PUBLIC_KEY: IMAGEKIT.publicKey,
  IMAGEKIT_PRIVATE_KEY: IMAGEKIT.privateKey,
  IMAGEKIT_FOLDER: "/stores/maysa",
};

let d1: TestD1;
let vars: Record<string, string>;
let scopes: string[];

const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
app.use("*", async (c, next) => {
  c.env = { DB: d1.raw, MEDIA_BUCKET: d1.bucket, ...vars } as never;
  signIn(c, { id: "u1", email: "s@example.com", name: "Samia", role: "staff", status: "active", apiKey: "k", scopes } as never);
  await next();
});
app.onError(errorHandler);
app.route("/api/media", uploadsRouter);
app.route("/media", serveRouter);

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const answer = async <T = any>(res: Response) => ({ status: res.status, body: (await res.json()) as T });
const ticket = (contentType: string, bytes: number, folder = "products") => app.request("/api/media/uploads", json("POST", { folder, contentType, bytes }));
/** The bytes sent as a relay ticket says: its method, its headers, to its URL. */
const relay = (send: { url: string; method: string; headers: Record<string, string> }, body: Uint8Array) => app.request(send.url, { method: send.method, headers: send.headers, body: body as BodyInit });
const complete = (id: string, report: Record<string, unknown> = {}) => app.request(`/api/media/uploads/${id}/complete`, json("POST", report));

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  vars = { ...TEST_MEDIA_VARS };
  scopes = ["products:read", "products:manage"];
  await d1.db.delete(schema.media);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an upload kept in the store's bucket", () => {
  it("is ticketed, relayed and completed into a ready image at the store's URL, then served", async () => {
    const file = webp(4096);
    const issued = await answer(await ticket("image/webp", file.byteLength));
    expect(issued.status).toBe(201);
    const { mediaId, key, send } = issued.body.data;
    expect(key).toMatch(/^products\/[a-f0-9]{32}\.webp$/);
    expect(send).toEqual({ kind: "relay", method: "PUT", url: `/api/media/uploads/${mediaId}/content`, headers: { "Content-Type": "image/webp" } });

    expect((await relay(send, file)).status).toBe(204);
    const done = await answer(await complete(mediaId, { width: 800, height: 600 }));
    expect(done).toEqual({ status: 200, body: { success: true, data: { key, url: `${TEST_DELIVERY.origin}/${key}`, width: 800, height: 600 } } });

    const served = await app.request(`/media/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(file);
  });

  it("is held to its ticket: other bytes than the type, or more than the size, are refused", async () => {
    const asWebp = (await answer(await ticket("image/webp", 4096))).body.data;
    expect(await answer(await relay(asWebp.send, png(4096)))).toMatchObject({ status: 400, body: { code: "INVALID_FILE_TYPE" } });

    const small = (await answer(await ticket("image/jpeg", 1000))).body.data;
    expect(await answer(await relay(small.send, jpeg(5000)))).toMatchObject({ status: 400, body: { code: "FILE_TOO_LARGE" } });
    expect(await d1.bucket.head(small.key)).toBeNull();
  });

  it("refuses a file that is no image, and a folder a browser may not upload into", async () => {
    expect((await ticket("application/pdf", 100)).status).toBe(400);
    expect((await ticket("image/webp", 100, "reviews")).status).toBe(400);
    expect((await relay({ url: `/api/media/uploads/${"0".repeat(32)}/content`, method: "PUT", headers: { "Content-Type": "application/pdf" } }, pdf())).status).toBe(404);
  });

  it("knows no upload it never ticketed, and completes none never sent", async () => {
    expect(await answer(await complete("0".repeat(32)))).toMatchObject({ status: 404, body: { code: "MEDIA_UPLOAD_UNKNOWN" } });
    const issued = (await answer(await ticket("image/webp", 4096))).body.data;
    expect(await answer(await complete(issued.mediaId))).toMatchObject({ status: 409, body: { code: "MEDIA_UPLOAD_MISSING" } });
  });

  it("serves only ready files: a pending one and an unknown key are 404", async () => {
    const issued = (await answer(await ticket("image/webp", 4096))).body.data;
    await relay(issued.send, webp(4096));
    expect(await answer(await app.request(`/media/${issued.key}`))).toMatchObject({ status: 404, body: { code: "MEDIA_NOT_FOUND" } });
    expect((await app.request("/media/products/nothing-here.webp")).status).toBe(404);
  });

  it("needs products:manage", async () => {
    scopes = ["products:read"];
    expect((await ticket("image/webp", 4096)).status).toBe(403);
  });
});

describe("an upload kept on ImageKit", () => {
  it("is ticketed as a signed form the browser posts to ImageKit, then completed", async () => {
    vars = IMAGEKIT_VARS;
    const imagekit = fakeImageKit(IMAGEKIT);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const origin = url.host === "upload.imagekit.io" ? imagekit.uploadOrigin : imagekit.apiOrigin;
      return imagekit.fetch(new Request(`${origin}${url.pathname}${url.search}`, request));
    });

    const file = png(2048);
    const { mediaId, key, send } = (await answer(await ticket("image/png", file.byteLength))).body.data;
    expect(send).toMatchObject({ kind: "form", url: "https://upload.imagekit.io/api/v2/files/upload", fileField: "file" });
    expect(send.fields).toMatchObject({ folder: `/stores/maysa/products`, useUniqueFileName: "false", overwriteFile: "false" });

    const form = new FormData();
    for (const [name, value] of Object.entries(send.fields as Record<string, string>)) form.set(name, value);
    form.set(send.fileField, new Blob([file as Uint8Array<ArrayBuffer>], { type: "image/png" }), send.fields.fileName);
    const posted = await fetch(send.url, { method: "POST", body: form });
    expect(posted.status).toBe(200);
    const { fileId } = (await posted.json()) as { fileId: string };

    const done = await answer(await complete(mediaId, { hostRef: fileId }));
    expect(done).toMatchObject({ status: 200, body: { data: { key, url: `https://ik.imagekit.io/wocart/stores/maysa/${key}` } } });
    expect(imagekit.files.has(`/stores/maysa/${key}`)).toBe(true);
    expect((await app.request(`/media/${key}`)).status).toBe(404);
  });
});

describe("a store whose media is not configured", () => {
  it("answers MEDIA_NOT_CONFIGURED, never a quiet default", async () => {
    for (const missing of ["MEDIA_HOST", "MEDIA_DELIVERY", "MEDIA_ORIGIN"]) {
      vars = { ...TEST_MEDIA_VARS };
      delete vars[missing];
      expect(await answer(await ticket("image/webp", 100))).toMatchObject({ status: 503, body: { code: "MEDIA_NOT_CONFIGURED" } });
    }
  });
});
