/**
 * An MCP agent's landing page image, added in the tool call that brings it:
 * the bytes are fetched from the agent's URL or decoded from base64, checked
 * against the type the agent claims, re-encoded to WebP when the Images
 * binding can (else kept as sent), kept by the Media Library on the store's
 * host under a fresh `landing/` key, inserted into the page's stack with
 * source "ai", and audited. Nothing waits anywhere first. A refusal is a
 * LandingImageError the agent can act on; a stored file whose row could not
 * be written is released again.
 */
import { getDb } from "@/db";
import { ACTIONS, logActivity } from "@/lib/activity";
import { parseImageDimensions, sniffImageType } from "@/lib/image-dimensions";
import { mediaDeliveryOf, mediaOf } from "@/lib/media";
import type { Env } from "@/types/env";
import type { ImageType } from "../../../cod-shared/media/keys";
import { addLandingPageImage, getLandingPageRow } from "../../../cod-shared/queries/landing-pages";

/** Decoded-byte cap on an agent's image. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * WebP encode quality for stored landing page images (Cloudflare Images
 * default; visually lossless for marketing creatives while cutting file size
 * ~25-35% vs JPEG/PNG).
 */
export const WEBP_QUALITY = 85;

/** How long the agent's URL may take to answer and send the image. */
export const FETCH_TIMEOUT_MS = 30_000;

/** The image types the store keeps (cod-shared/media/keys IMAGE_TYPES), with the image/jpg alias agents send. */
export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/** Canonicalize the "image/jpg" alias so it compares equal to "image/jpeg". */
export function canonicalImageContentType(contentType: string): string {
  return contentType === "image/jpg" ? "image/jpeg" : contentType;
}

/** Base64 input cap: 8 MB decoded → ~11.18 M base64 chars, plus slack for
 *  padding and tolerated whitespace. Rejects oversized payloads before decode. */
export const BASE64_MAX_INPUT_LENGTH =
  Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 1024;

/**
 * Decode agent-supplied base64 image bytes. Tolerates a `data:<mime>;base64,`
 * prefix and embedded whitespace — models send both. Throws on invalid base64.
 */
export function decodeBase64Image(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A refusal the agent can act on: its message says what to send instead. */
export class LandingImageError extends Error {
  override readonly name = "LandingImageError";
}

export type LandingImageSource = { kind: "url"; url: string } | { kind: "bytes"; bytes: Uint8Array<ArrayBuffer> };

export interface AddedLandingImage {
  imageId: string;
  key: string;
  url: string;
  position: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  /** True when the stored file is WebP (re-encoded now, or the source already was). */
  converted: boolean;
  /** The stored file's type — image/webp, or the source type when it could not be re-encoded. */
  storedContentType: string;
}

/**
 * Read a response body up to capBytes, aborting the stream the moment the
 * cap is exceeded — an unbounded arrayBuffer() on a lying/large response
 * would buffer the whole payload in Worker memory before any check runs.
 */
async function readBodyWithCap(response: Response, capBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = (bytes: number) => new LandingImageError(`Image exceeds the 8 MB cap (${bytes} bytes).`);
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > capBytes) throw tooLarge(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > capBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = (error as Error)?.name === "TimeoutError";
    throw new LandingImageError(
      timedOut
        ? `The image URL did not answer within ${FETCH_TIMEOUT_MS / 1000} seconds — retry, or re-host the image.`
        : `The image URL could not be fetched (${(error as Error)?.message ?? "network error"}) — retry, or re-host the image.`,
    );
  }
  if ([401, 403, 404].includes(response.status)) {
    throw new LandingImageError(
      `Image URL returned HTTP ${response.status} — the link is not publicly fetchable or has expired. ` +
        "Re-generate the image and provide its direct download URL.",
    );
  }
  if (!response.ok) throw new LandingImageError(`Image URL fetch failed with HTTP ${response.status} — retry, or re-host the image.`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) throw new LandingImageError(`Image exceeds the 8 MB cap (content-length: ${declaredLength} bytes).`);
  const bytes = await readBodyWithCap(response, MAX_IMAGE_BYTES);
  if (bytes.byteLength === 0) throw new LandingImageError("Image URL returned an empty body.");
  return bytes;
}

/**
 * WebP via the Images binding, billed as one unique transformation. Fail-open:
 * an absent binding, a plan/quota error, or any encode failure returns null,
 * and the original bytes are kept under a key with their own extension.
 */
async function transcodeToWebp(env: Env, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!env.IMAGE_TRANSFORM) {
    console.error("[lp-image-upload] IMAGE_TRANSFORM binding not provisioned — storing original format");
    return null;
  }
  try {
    const transformed = await env.IMAGE_TRANSFORM.input(new Blob([bytes]).stream()).output({ format: "image/webp", quality: WEBP_QUALITY });
    const result = transformed.response();
    if (!result.ok) {
      console.error(`[lp-image-upload] WebP transcode failed (HTTP ${result.status}) — storing original format`);
      return null;
    }
    const webp = new Uint8Array(await result.arrayBuffer());
    if (webp.byteLength === 0) {
      console.error("[lp-image-upload] WebP transcode returned empty body — storing original format");
      return null;
    }
    return webp;
  } catch (error) {
    console.error(`[lp-image-upload] WebP transcode error: ${error instanceof Error ? error.message : String(error)} — storing original format`);
    return null;
  }
}

export async function addAgentLandingImage(
  env: Env,
  input: {
    landingPageId: string;
    source: LandingImageSource;
    contentType: string;
    altText?: string | null;
    position?: number;
    actor: { id: string; name: string; role: "admin" | "staff" };
  },
): Promise<AddedLandingImage> {
  const db = getDb(env.DB);
  const landingPage = await getLandingPageRow(db, input.landingPageId);
  if (!landingPage) throw new LandingImageError(`Landing page ${input.landingPageId} not found`);

  const bytes = input.source.kind === "bytes" ? input.source.bytes : await download(input.source.url);
  if (bytes.byteLength === 0) throw new LandingImageError("The image is empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new LandingImageError(`Image exceeds the 8 MB cap (${bytes.byteLength} bytes).`);
  const sniffed = sniffImageType(bytes);
  const claimed = canonicalImageContentType(input.contentType);
  if (!sniffed) throw new LandingImageError("The bytes are not a recognized image (png, jpeg, webp, or gif).");
  if (sniffed !== claimed) throw new LandingImageError(`Content mismatch: the bytes are ${sniffed} but contentType claimed ${input.contentType}.`);

  const webp = sniffed === "image/webp" ? bytes : await transcodeToWebp(env, bytes);
  const stored = webp ?? bytes;
  const storedContentType = (webp ? "image/webp" : sniffed) as ImageType;
  const dimensions = parseImageDimensions(stored);
  const media = mediaOf(env);
  const file = await media.store({ folder: "landing", contentType: storedContentType, body: stored, width: dimensions?.width ?? null, height: dimensions?.height ?? null });

  let image: Awaited<ReturnType<typeof addLandingPageImage>>[number] | undefined;
  try {
    const stack = await addLandingPageImage(
      db,
      input.landingPageId,
      { mediaKey: file.key, altText: input.altText ?? null, ...(input.position !== undefined ? { position: input.position } : {}), width: file.width, height: file.height, source: "ai" },
      mediaDeliveryOf(env),
    );
    image = stack.find((row) => row.key === file.key);
  } catch (error) {
    await media.release([file.key]).catch(() => {});
    throw error;
  }
  if (!image) throw new Error(`Inserted image row for key ${file.key} not found in the resulting stack.`);

  await logActivity(
    db,
    input.actor,
    ACTIONS.LANDING_PAGE_UPDATED,
    { type: "landing_page", id: input.landingPageId, label: landingPage.name },
    {
      via: "mcp",
      action: "image_added",
      source: "ai",
      imageId: image.id,
      mediaKey: file.key,
      uploadKind: input.source.kind,
      byteSize: file.bytes ?? stored.byteLength,
      storedContentType,
      convertedToWebp: webp !== null,
    },
  );

  return {
    imageId: image.id,
    key: file.key,
    url: image.url,
    position: image.position,
    width: image.width,
    height: image.height,
    altText: image.altText,
    converted: webp !== null,
    storedContentType,
  };
}
