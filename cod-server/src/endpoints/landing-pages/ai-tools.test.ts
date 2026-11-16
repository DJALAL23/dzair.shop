/**
 * Landing-pages MCP tools — unit tests for the two-layer validation contract.
 *
 * Proves the Slice-1 hygiene guarantees:
 *   • publishLandingPage never reports success for a nonexistent page (F4)
 *   • publishing an empty stack returns an explicit warning (F4)
 *   • unknown fields are REJECTED, never silently stripped (F5) — the model
 *     gets an actionable error it can recover from
 *   • the STOREFRONT_URL fallback flows from the registry env into every
 *     publicUrl the tools return (F7)
 *
 * And the upload contract:
 *   • uploadLandingPageImage: exactly one of image/imageUrl/imageBase64,
 *     data-URI tolerance, the source it hands on, the inserted image it
 *     answers with, and refusals the agent can act on. Fetching, checking,
 *     storing and inserting are lib/landing-image-upload.ts, proved on real
 *     D1 in landing-image-upload.e2e.test.ts.
 *
 * The queries module, the cod-shared URL helpers and the image adder are
 * mocked — these tests cover the tool layer's own logic, not D1 behavior
 * (that lives in the e2e suites). Base64 decoding runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const landingQueries = vi.hoisted(() => ({
  listLandingPages: vi.fn(),
  getLandingPageById: vi.fn(),
  createLandingPage: vi.fn(),
  updateLandingPage: vi.fn(),
  publishLandingPage: vi.fn(),
  unpublishLandingPage: vi.fn(),
  archiveLandingPage: vi.fn(),
  duplicateLandingPage: vi.fn(),
  deleteLandingPageWithGuard: vi.fn(),
  getLandingPageImage: vi.fn(),
  getLandingPageImages: vi.fn(),
  deleteLandingPageImage: vi.fn(),
  getLandingPageRow: vi.fn(),
  reorderLandingPageImagesChecked: vi.fn(),
}));

vi.mock("./queries", () => landingQueries);

const releaseShown = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/media", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/media")>()), releaseShown }));

const sharedLandingQueries = vi.hoisted(() => ({
  resolveStorefrontBaseUrl: vi.fn(),
  buildLandingPagePublicUrl: vi.fn(
    (baseUrl: string | null, slug: string) => (baseUrl ? `${baseUrl}/lp/${slug}` : `/lp/${slug}`),
  ),
}));

vi.mock("../../../../cod-shared/queries/landing-pages", () => sharedLandingQueries);

const addAgentLandingImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/landing-image-upload", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/landing-image-upload")>()), addAgentLandingImage }));

import { getLandingPageTools, LANDING_PAGE_TOOL_OUTPUT_SCHEMAS } from "./ai-tools";
import { decodeBase64Image, LandingImageError } from "@/lib/landing-image-upload";
import { TEST_DELIVERY, TEST_MEDIA_VARS } from "@/test-utils/media";

const db = {} as never;
const ENV = { STOREFRONT_URL: "https://fallback.example.com", ...TEST_MEDIA_VARS };
/** Valid RFC 9562 v4 UUID — zod 4's uuid() enforces version + variant nibbles. */
const UUID = "6f0c9b8e-3d2a-4e5f-8a7b-9c1d2e3f4a5b";

type Executable = { execute?: (args: unknown, options: unknown) => Promise<unknown> };

const SESSION = { userId: "user-1", role: "staff" as const, name: "Ada", email: "ada@example.com" };

async function call(
  toolName: string,
  args: unknown,
  env: Record<string, unknown> = ENV,
  session: unknown = SESSION,
): Promise<Record<string, unknown>> {
  const bundle = getLandingPageTools(
    db,
    env as never,
    session as never,
  ) as unknown as Record<string, Executable>;
  const t = bundle[toolName];
  if (!t?.execute) throw new Error(`tool ${toolName} has no execute`);
  return (await t.execute(args, { toolCallId: "test" })) as Record<string, unknown>;
}

const lpWithImages = {
  id: UUID,
  slug: "lp-abc12345",
  name: "Test page",
  status: "draft",
  productId: "prod-1",
  imageGap: 0,
  publishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  images: [
    {
      id: "img-1",
      landingPageId: UUID,
      key: "landing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      url: `${TEST_DELIVERY.origin}/landing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png`,
      altText: null,
      source: "upload",
      position: 1,
      width: 1080,
      height: 1350,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "img-2",
      landingPageId: UUID,
      key: "landing/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
      url: `${TEST_DELIVERY.origin}/landing/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png`,
      altText: null,
      source: "ai",
      position: 2,
      width: null,
      height: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  product: null,
};

const lpEmptyStack = { ...lpWithImages, images: [] };

describe("publishLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue("https://fallback.example.com");
  });

  it("returns failure for a nonexistent landing page and never publishes (F4)", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(null);
    landingQueries.getLandingPageRow.mockResolvedValue(null);

    const res = await call("publishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
    expect(landingQueries.publishLandingPage).not.toHaveBeenCalled();
  });

  it("publishes but warns when the image stack is empty, with the fallback URL (F4 + F7)", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(lpEmptyStack);
    landingQueries.getLandingPageRow.mockResolvedValue(lpEmptyStack);

    const res = await call("publishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(true);
    expect(res.warning).toEqual(expect.stringContaining("EMPTY image stack"));
    expect(res.publicUrl).toBe("https://fallback.example.com/lp/lp-abc12345");
    expect(sharedLandingQueries.resolveStorefrontBaseUrl).toHaveBeenCalledWith(
      db,
      "https://fallback.example.com",
    );
  });

  it("publishes without a warning when the stack has images", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(lpWithImages);
    landingQueries.getLandingPageRow.mockResolvedValue(lpWithImages);

    const res = await call("publishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  it("rejects unknown fields", async () => {
    const res = await call("publishLandingPage", { landingPageId: UUID, force: true });

    expect(res.success).toBe(false);
    expect(res.error).toContain("force");
    expect(landingQueries.getLandingPageById).not.toHaveBeenCalled();
  });
});

describe("createLandingPage — strict layer-2 (F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue("https://fallback.example.com");
  });

  it("rejects an `images` field instead of silently stripping it", async () => {
    const res = await call("createLandingPage", {
      name: "My page",
      productId: UUID,
      images: [{ src: "https://x/y.png" }],
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("images");
    expect(landingQueries.createLandingPage).not.toHaveBeenCalled();
  });

  it("rejects a hallucinated `status` field", async () => {
    const res = await call("createLandingPage", {
      name: "My page",
      productId: UUID,
      status: "published",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("status");
    expect(landingQueries.createLandingPage).not.toHaveBeenCalled();
  });

  it("creates a valid draft and returns the fallback publicUrl", async () => {
    landingQueries.createLandingPage.mockResolvedValue({ id: UUID, slug: "lp-abc12345" });
    landingQueries.getLandingPageById.mockResolvedValue(lpWithImages);
    landingQueries.getLandingPageRow.mockResolvedValue(lpWithImages);

    const res = await call("createLandingPage", { name: "My page", productId: UUID });

    expect(res.success).toBe(true);
    expect(res.publicUrl).toBe("https://fallback.example.com/lp/lp-abc12345");
    expect(sharedLandingQueries.resolveStorefrontBaseUrl).toHaveBeenCalledWith(
      db,
      "https://fallback.example.com",
    );
  });
});

describe("updateLandingPage — strict layer-2 (F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unknown field inside updates", async () => {
    const res = await call("updateLandingPage", {
      landingPageId: UUID,
      updates: { imageGap: 10, images: ["a"] },
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("images");
    expect(landingQueries.updateLandingPage).not.toHaveBeenCalled();
  });

  it("applies a valid partial update", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(lpWithImages);
    landingQueries.getLandingPageRow.mockResolvedValue(lpWithImages);

    const res = await call("updateLandingPage", {
      landingPageId: UUID,
      updates: { imageGap: 10 },
    });

    expect(res.success).toBe(true);
    expect(landingQueries.updateLandingPage).toHaveBeenCalledWith(db, UUID, { imageGap: 10 });
  });
});

describe("listLandingPages — strict layer-2 + pagination (F5, Slice 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue(null);
  });

  it("rejects unknown filter fields", async () => {
    const res = await call("listLandingPages", { productId: UUID, sortBy: "createdAt" });

    expect(res.success).toBe(false);
    expect(res.error).toContain("sortBy");
  });

  it("rejects an out-of-range limit", async () => {
    const res = await call("listLandingPages", { limit: 500 });

    expect(res.success).toBe(false);
    expect(res.error).toContain("limit");
    expect(landingQueries.listLandingPages).not.toHaveBeenCalled();
  });

  it("defaults to limit 50, offset 0 — the LLM context stays bounded", async () => {
    landingQueries.listLandingPages.mockResolvedValue([]);

    const res = await call("listLandingPages", {});

    expect(res.success).toBe(true);
    expect(res.count).toBe(0);
    expect(landingQueries.listLandingPages).toHaveBeenCalledWith(db, {}, { limit: 50, offset: 0 });
    expect(sharedLandingQueries.resolveStorefrontBaseUrl).toHaveBeenCalledWith(
      db,
      "https://fallback.example.com",
    );
  });

  it("passes explicit paging through to the query layer", async () => {
    landingQueries.listLandingPages.mockResolvedValue([]);

    await call("listLandingPages", { limit: 20, offset: 40, status: "published" });

    expect(landingQueries.listLandingPages).toHaveBeenCalledWith(
      db,
      { status: "published" },
      { limit: 20, offset: 40 },
    );
  });
});

describe("deleteLandingPage — strict layer-2 (F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unknown fields", async () => {
    const res = await call("deleteLandingPage", { landingPageId: UUID, force: true });

    expect(res.success).toBe(false);
    expect(res.error).toContain("force");
    expect(landingQueries.deleteLandingPageWithGuard).not.toHaveBeenCalled();
  });

  it("refuses a page with attributed orders through the one delete guard", async () => {
    landingQueries.deleteLandingPageWithGuard.mockRejectedValue(
      new Error("Cannot delete a landing page with attributed orders — archive it instead so history stays intact"),
    );

    const res = await call("deleteLandingPage", { landingPageId: UUID });

    expect(landingQueries.deleteLandingPageWithGuard).toHaveBeenCalledWith(db, UUID);
    expect(res.success).toBe(false);
    expect(res.error).toContain("attributed orders");
  });
});

/** Real 1x1 px PNG — the sniff/decode path runs against real bytes. */
const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const KEY_HEX = "a".repeat(32);
const R2_KEY = `landing/${KEY_HEX}.png`;

const ADDED = {
  imageId: "img-9",
  key: R2_KEY,
  url: `${TEST_DELIVERY.origin}/${R2_KEY}`,
  position: 3,
  width: 1,
  height: 1,
  altText: "Hero",
  converted: true,
  storedContentType: "image/webp",
};

const upload = (args: Record<string, unknown>, session: unknown = SESSION) => call("uploadLandingPageImage", { landingPageId: UUID, contentType: "image/png", ...args }, ENV, session);
const handedOn = () => addAgentLandingImage.mock.calls[0]![1];

describe("uploadLandingPageImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addAgentLandingImage.mockResolvedValue(ADDED);
  });

  it("adds an image from a URL during the call and answers with the inserted image", async () => {
    const res = await upload({ imageUrl: "https://images.openai.example/gen.png", altText: "Hero", position: 3 });

    expect(res).toMatchObject({ success: true, image: ADDED });
    expect(res.advice).toContain("publishLandingPage");
    expect(addAgentLandingImage).toHaveBeenCalledTimes(1);
    expect(addAgentLandingImage.mock.calls[0]![0]).toBe(ENV);
    expect(handedOn()).toEqual({
      landingPageId: UUID,
      source: { kind: "url", url: "https://images.openai.example/gen.png" },
      contentType: "image/png",
      altText: "Hero",
      position: 3,
      actor: { id: "user-1", name: "Ada", role: "staff" },
    });
  });

  it("hands on base64 bytes decoded, and no position when none was asked", async () => {
    await upload({ imageBase64: PNG_1x1_BASE64 });
    expect(handedOn()).toMatchObject({ source: { kind: "bytes", bytes: decodeBase64Image(PNG_1x1_BASE64) }, altText: null });
    expect(handedOn()).not.toHaveProperty("position");
  });

  it("tolerates a data-URI prefix and whitespace in imageBase64", async () => {
    const dataUri = `data:image/png;base64,\n${PNG_1x1_BASE64.slice(0, 20)}\n${PNG_1x1_BASE64.slice(20)}`;
    expect((await upload({ imageBase64: dataUri })).success).toBe(true);
    expect(handedOn().source.bytes).toEqual(decodeBase64Image(PNG_1x1_BASE64));
  });

  it("names the actor by email, then id, when the session has no name", async () => {
    await upload({ imageUrl: "https://x/y.png" }, { ...SESSION, name: "" });
    expect(handedOn().actor).toEqual({ id: "user-1", name: "ada@example.com", role: "staff" });
  });

  it("rejects providing both imageUrl and imageBase64", async () => {
    const res = await upload({ imageUrl: "https://x/y.png", imageBase64: PNG_1x1_BASE64 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("exactly one");
    expect(addAgentLandingImage).not.toHaveBeenCalled();
  });

  it("rejects providing neither image, imageUrl, nor imageBase64", async () => {
    const res = await upload({});
    expect(res.success).toBe(false);
    expect(res.error).toContain("exactly one");
    expect(addAgentLandingImage).not.toHaveBeenCalled();
  });

  describe("image file object (openai/fileParams — ChatGPT path)", () => {
    it("adds the image from the client-provided download_url", async () => {
      const res = await upload({
        image: {
          download_url: "https://files.oaiusercontent.example/file_abc123?sig=xyz",
          file_id: "file_abc123",
          mime_type: "image/png",
          file_name: "generated.png",
        },
      });
      expect(res.success).toBe(true);
      expect(handedOn().source).toEqual({ kind: "url", url: "https://files.oaiusercontent.example/file_abc123?sig=xyz" });
    });

    it("rejects combining the image file object with imageUrl or imageBase64", async () => {
      for (const extra of [{ imageUrl: "https://x/y.png" }, { imageBase64: PNG_1x1_BASE64 }]) {
        const res = await upload({ image: { download_url: "https://x/y.png", file_id: "f1" }, ...extra });
        expect(res.success).toBe(false);
        expect(res.error).toContain("exactly one");
      }
      expect(addAgentLandingImage).not.toHaveBeenCalled();
    });

    it("rejects a file object missing download_url (schema contract)", async () => {
      const res = await upload({ image: { file_id: "f1" } });
      expect(res.success).toBe(false);
      expect(res.error).toContain("download_url");
      expect(addAgentLandingImage).not.toHaveBeenCalled();
    });

    it("rejects a non-http download_url with an actionable error", async () => {
      const res = await upload({ image: { download_url: "ftp://x/y.png", file_id: "f1" } });
      expect(res.success).toBe(false);
      expect(res.error).toContain("http(s)");
      expect(addAgentLandingImage).not.toHaveBeenCalled();
    });
  });

  it("rejects non-http(s) imageUrl", async () => {
    const res = await upload({ imageUrl: "ftp://x/y.png" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("http(s)");
    expect(addAgentLandingImage).not.toHaveBeenCalled();
  });

  it("rejects invalid base64", async () => {
    const res = await upload({ imageBase64: "!!!not-base64!!!" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("valid base64");
    expect(addAgentLandingImage).not.toHaveBeenCalled();
  });

  it("rejects a disallowed contentType", async () => {
    const res = await upload({ imageUrl: "https://x/y.svg", contentType: "image/svg+xml" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("contentType");
  });

  it("answers a refusal with its own words, so the agent can act on it", async () => {
    addAgentLandingImage.mockRejectedValue(new LandingImageError("Content mismatch: the bytes are image/png but contentType claimed image/jpeg."));
    expect(await upload({ imageBase64: PNG_1x1_BASE64, contentType: "image/jpeg" })).toEqual({ success: false, error: "Content mismatch: the bytes are image/png but contentType claimed image/jpeg." });
  });

  it("answers any other failure as a failed upload", async () => {
    addAgentLandingImage.mockRejectedValue(new Error("D1 is down"));
    expect(await upload({ imageUrl: "https://x/y.png" })).toEqual({ success: false, error: "Failed to upload image: D1 is down" });
  });

  it("fails closed when no session identity is attached", async () => {
    const res = await upload({ imageUrl: "https://x/y.png" }, null);
    expect(res.success).toBe(false);
    expect(res.error).toContain("session identity");
    expect(addAgentLandingImage).not.toHaveBeenCalled();
  });
});

describe("removeLandingPageImage", () => {
  const IMG_UUID = "7d1e0c9a-4b3f-4c6d-9e8a-1f2a3b4c5d6e";
  const imageRow = { id: IMG_UUID, landingPageId: UUID, mediaKey: R2_KEY, position: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the row, then releases its file to the store's media, and returns the stack", async () => {
    landingQueries.getLandingPageImage.mockResolvedValue(imageRow);
    landingQueries.deleteLandingPageImage.mockResolvedValue(undefined);
    landingQueries.getLandingPageImages.mockResolvedValue([]);

    const res = await call("removeLandingPageImage", { landingPageId: UUID, imageId: IMG_UUID });

    expect(res.success).toBe(true);
    expect(res.images).toEqual([]);
    expect(res.count).toBe(0);
    expect(landingQueries.deleteLandingPageImage).toHaveBeenCalledWith(db, UUID, IMG_UUID);
    expect(releaseShown).toHaveBeenCalledWith(expect.objectContaining({ MEDIA_HOST: "r2" }), [R2_KEY], expect.any(String));
    expect(landingQueries.deleteLandingPageImage.mock.invocationCallOrder[0]).toBeLessThan(releaseShown.mock.invocationCallOrder[0]!);
  });

  it("removes the image even when its file cannot be deleted now", async () => {
    landingQueries.getLandingPageImage.mockResolvedValue(imageRow);
    landingQueries.deleteLandingPageImage.mockResolvedValue(undefined);
    landingQueries.getLandingPageImages.mockResolvedValue([]);
    releaseShown.mockResolvedValueOnce(0);

    const res = await call("removeLandingPageImage", { landingPageId: UUID, imageId: IMG_UUID });

    expect(res.success).toBe(true);
    expect(landingQueries.deleteLandingPageImage).toHaveBeenCalled();
  });

  it("fails for an image that does not exist on that landing page", async () => {
    landingQueries.getLandingPageImage.mockResolvedValue(null);

    const res = await call("removeLandingPageImage", { landingPageId: UUID, imageId: IMG_UUID });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
    expect(releaseShown).not.toHaveBeenCalled();
  });

  it("rejects unknown fields", async () => {
    const res = await call(
      "removeLandingPageImage",
      { landingPageId: UUID, imageId: IMG_UUID, force: true },
      { STOREFRONT_URL: "https://fallback.example.com" },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("force");
  });
});

describe("reorderLandingPageImages", () => {
  const ID_A = "8a2f1d3b-5c4e-4f60-8b7c-9d0e1f2a3b4c";
  const ID_B = "9b3a2e4c-6d5f-4a71-9c8d-0e1f2a3b4c5d";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the complete ordered set and returns the new stack", async () => {
    const ordered = [
      { id: ID_B, position: 1 },
      { id: ID_A, position: 2 },
    ];
    landingQueries.reorderLandingPageImagesChecked.mockResolvedValue(ordered);

    const res = await call("reorderLandingPageImages", {
      landingPageId: UUID,
      imageIds: [ID_B, ID_A],
    });

    expect(res.success).toBe(true);
    expect(res.images).toEqual(ordered);
    expect(landingQueries.reorderLandingPageImagesChecked).toHaveBeenCalledWith(db, UUID, [ID_B, ID_A], TEST_DELIVERY);
  });

  it("surfaces the checked wrapper's validation failures", async () => {
    landingQueries.reorderLandingPageImagesChecked.mockRejectedValue(
      new Error("imageIds must not contain duplicates"),
    );

    const res = await call("reorderLandingPageImages", {
      landingPageId: UUID,
      imageIds: [ID_A, ID_A],
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("duplicates");
  });

  it("rejects an empty imageIds array at the schema layer", async () => {
    const res = await call("reorderLandingPageImages", { landingPageId: UUID, imageIds: [] });

    expect(res.success).toBe(false);
    expect(landingQueries.reorderLandingPageImagesChecked).not.toHaveBeenCalled();
  });
});

describe("duplicateLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue("https://fallback.example.com");
  });

  it("returns the fresh draft with its new slug and link", async () => {
    landingQueries.duplicateLandingPage.mockResolvedValue("new-id-1");
    landingQueries.getLandingPageById.mockResolvedValue({ ...lpWithImages, id: "new-id-1", slug: "lp-copy0001" });
    landingQueries.getLandingPageRow.mockResolvedValue({ ...lpWithImages, id: "new-id-1", slug: "lp-copy0001" });

    const res = await call("duplicateLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(true);
    expect(res.publicUrl).toBe("https://fallback.example.com/lp/lp-copy0001");
    expect(res.note).toContain("Fresh draft");
  });

  it("fails for a nonexistent landing page", async () => {
    landingQueries.duplicateLandingPage.mockResolvedValue(null);

    const res = await call("duplicateLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
  });
});

describe("unpublishLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue("https://fallback.example.com");
  });

  it("returns the page to draft and reports the (now dead) link", async () => {
    landingQueries.getLandingPageById.mockResolvedValue({ ...lpWithImages, status: "published" });
    landingQueries.getLandingPageRow.mockResolvedValue({ ...lpWithImages, status: "published" });
    landingQueries.unpublishLandingPage.mockResolvedValue(undefined);

    const res = await call("unpublishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(true);
    expect(landingQueries.unpublishLandingPage).toHaveBeenCalledWith(db, UUID);
    expect(res.publicUrl).toBe("https://fallback.example.com/lp/lp-abc12345");
  });

  it("fails for a nonexistent landing page and never unpublishes", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(null);
    landingQueries.getLandingPageRow.mockResolvedValue(null);

    const res = await call("unpublishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
    expect(landingQueries.unpublishLandingPage).not.toHaveBeenCalled();
  });
});

describe("archiveLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives and returns the page state with history preserved", async () => {
    landingQueries.getLandingPageById.mockResolvedValue({ ...lpWithImages, status: "published" });
    landingQueries.getLandingPageRow.mockResolvedValue({ ...lpWithImages, status: "published" });
    landingQueries.archiveLandingPage.mockResolvedValue(undefined);

    const res = await call("archiveLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(true);
    expect(res.message).toContain("preserved");
    expect(landingQueries.archiveLandingPage).toHaveBeenCalledWith(db, UUID);
  });

  it("fails for a nonexistent landing page and never archives", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(null);
    landingQueries.getLandingPageRow.mockResolvedValue(null);

    const res = await call("archiveLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
    expect(landingQueries.archiveLandingPage).not.toHaveBeenCalled();
  });

  it("rejects unknown fields", async () => {
    const res = await call("archiveLandingPage", { landingPageId: UUID, keepStats: true });

    expect(res.success).toBe(false);
    expect(res.error).toContain("keepStats");
  });
});

describe("output schemas match what the tools actually return (structuredContent contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedLandingQueries.resolveStorefrontBaseUrl.mockResolvedValue("https://fallback.example.com");
  });

  it("listLandingPages result validates against its output schema", async () => {
    landingQueries.listLandingPages.mockResolvedValue([
      {
        id: UUID,
        slug: "lp-abc12345",
        name: "Zinc page",
        status: "published",
        productId: "p1",
        productName: "Zinc",
        productHandle: "zinc",
        imageCount: 3,
        publishedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const res = await call("listLandingPages", {});

    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["listLandingPages"]!.safeParse(res).success).toBe(true);
  });

  it("publishLandingPage empty-stack warning variant validates (warning is declared)", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(lpEmptyStack);
    landingQueries.getLandingPageRow.mockResolvedValue(lpEmptyStack);

    const res = await call("publishLandingPage", { landingPageId: UUID });

    expect(res.warning).toBeDefined();
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["publishLandingPage"]!.safeParse(res).success).toBe(true);
  });

  it("publishLandingPage handled failure validates against the failure envelope", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(null);
    landingQueries.getLandingPageRow.mockResolvedValue(null);

    const res = await call("publishLandingPage", { landingPageId: UUID });

    expect(res.success).toBe(false);
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["publishLandingPage"]!.safeParse(res).success).toBe(true);
  });

  it("uploadLandingPageImage results validate, added and refused (the ChatGPT pipeline contract)", async () => {
    addAgentLandingImage.mockResolvedValue(ADDED);
    const added = await upload({ imageUrl: "https://x/y.png" });
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["uploadLandingPageImage"]!.safeParse(added).success).toBe(true);
    addAgentLandingImage.mockRejectedValue(new LandingImageError("Image URL returned HTTP 404"));
    const refused = await upload({ imageUrl: "https://x/y.png" });
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["uploadLandingPageImage"]!.safeParse(refused).success).toBe(true);
  });

  it("archiveLandingPage and reorderLandingPageImages results validate", async () => {
    landingQueries.getLandingPageById.mockResolvedValue(lpWithImages);
    landingQueries.getLandingPageRow.mockResolvedValue(lpWithImages);
    landingQueries.archiveLandingPage.mockResolvedValue(undefined);
    const archived = await call("archiveLandingPage", { landingPageId: UUID });
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["archiveLandingPage"]!.safeParse(archived).success).toBe(true);

    landingQueries.reorderLandingPageImagesChecked.mockResolvedValue([
      { id: "img-1", landingPageId: UUID, position: 1, key: R2_KEY, url: `${TEST_DELIVERY.origin}/${R2_KEY}`, altText: null, width: 1, height: 1, source: "ai", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const reordered = await call("reorderLandingPageImages", {
      landingPageId: UUID,
      imageIds: ["8a2f1d3b-5c4e-4f60-8b7c-9d0e1f2a3b4c"],
    });
    expect(LANDING_PAGE_TOOL_OUTPUT_SCHEMAS["reorderLandingPageImages"]!.safeParse(reordered).success).toBe(true);
  });
});
