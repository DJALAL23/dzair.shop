/**
 * CodLandingPageImageUploadWorkflow — durable background upload of a landing
 * page image from an MCP agent (ChatGPT, Claude, ...), on the Media Library
 * (ADR 0021).
 *
 * Two entry shapes share one tail:
 *   kind "url"   — the agent supplies a fetchable http(s) image URL; this
 *                  workflow downloads it (retried, size-capped, magic-byte-
 *                  verified). Image bytes can never travel through workflow
 *                  params (1 MiB payload cap), so the URL is fetched here,
 *                  inside a durable step.
 *   kind "bytes" — the tool already put the decoded base64 bytes in Staging
 *                  (`staging/landing/<job>`); this workflow reads them there.
 *
 * Both are then prepared — re-encoded to WebP when the Images binding can
 * (else kept as sent), measured — and stored by the Media Library as
 * `landing/<job>.<ext>`; the landing_page_images row is inserted with source
 * "ai" (idempotent on its key), Staging is cleared, the addition audited, and
 * the image returned as the instance output getLandingPageImageUploadStatus
 * polls.
 *
 * Instance ID: `lpimg-<job>` — minted by the upload tool, unique per upload
 * attempt (Workflows instance IDs are unique forever).
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { z } from "zod";
import type { Env } from "@/types/env";
import { getDb } from "@/db";
import { parseImageDimensions, sniffImageType } from "@/lib/image-dimensions";
import {
  canonicalImageContentType,
  IMAGE_CONTENT_TYPES,
  LANDING_UPLOAD_JOB_PATTERN,
  MAX_IMAGE_BYTES,
  WEBP_QUALITY,
} from "@/lib/landing-image-upload";
import { mediaDeliveryOf, mediaOf } from "@/lib/media";
import { staging, stagingKey } from "@/lib/staging";
import { addLandingPageImage, getLandingPageImages, getLandingPageRow } from "../../../cod-shared/queries/landing-pages";
import { extensionOf, type ImageType } from "../../../cod-shared/media/keys";
import { ACTIONS, logActivity } from "@/lib/activity";

const actorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["admin", "staff"]),
});

const baseShape = {
  landingPageId: z.string().uuid(),
  job: z.string().regex(LANDING_UPLOAD_JOB_PATTERN),
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  altText: z.string().max(1000).nullable().optional(),
  position: z.number().int().min(1).optional(),
  actor: actorSchema,
};

export const CodLandingPageImageUploadParamsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...baseShape,
    kind: z.literal("url"),
    imageUrl: z.url({ protocol: /^https?$/, message: "imageUrl must be an http(s) URL" }),
  }),
  z.strictObject({
    ...baseShape,
    kind: z.literal("bytes"),
  }),
]);

export type CodLandingPageImageUploadParams = z.infer<typeof CodLandingPageImageUploadParamsSchema>;

export type CodLandingPageImageUploadOutput = {
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
};

interface PreparedImage {
  key: string;
  size: number;
  storedContentType: string;
  converted: boolean;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * Read a response body up to capBytes, aborting the stream the moment the
 * cap is exceeded — an unbounded arrayBuffer() on a lying/large response
 * would buffer the whole payload in Worker memory before any check runs.
 */
async function readBodyWithCap(response: Response, capBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > capBytes) {
      throw new NonRetryableError(`Image exceeds the 8 MB cap (${buffer.byteLength} bytes).`);
    }
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
      throw new NonRetryableError(
        `Image exceeds the 8 MB cap (${total} bytes read so far).`,
      );
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

/**
 * Transcode source bytes to WebP via the Cloudflare Images binding so landing
 * page images are STORED in the fast format (not converted per-request).
 * Billed as unique transformations — 5,000/month free, one per upload.
 *
 * Fail-open by design: an absent binding, a plan/quota error, or any encode
 * failure returns null and the caller keeps the original bytes, under a key
 * with their own extension — the upload never breaks because of the
 * optimization step, it just keeps the original format.
 */
async function transcodeToWebp(
  env: Env,
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  if (!env.IMAGE_TRANSFORM) {
    console.error("[lp-image-upload] IMAGE_TRANSFORM binding not provisioned — storing original format");
    return null;
  }
  try {
    const transformed = await env.IMAGE_TRANSFORM.input(new Blob([bytes]).stream()).output({
      format: "image/webp",
      quality: WEBP_QUALITY,
    });
    const result = transformed.response();
    if (!result.ok) {
      console.error(
        `[lp-image-upload] WebP transcode failed (HTTP ${result.status}) — storing original format`,
      );
      return null;
    }
    const webp = new Uint8Array(await result.arrayBuffer());
    if (webp.byteLength === 0) {
      console.error("[lp-image-upload] WebP transcode returned empty body — storing original format");
      return null;
    }
    return webp;
  } catch (error) {
    console.error(
      `[lp-image-upload] WebP transcode error: ${error instanceof Error ? error.message : String(error)} — storing original format`,
    );
    return null;
  }
}

/** The source bytes: downloaded from the agent's URL, or read from Staging. */
async function acquire(env: Env, params: CodLandingPageImageUploadParams): Promise<Uint8Array> {
  if (params.kind === "bytes") {
    const staged = await staging(env.MEDIA_BUCKET).read(stagingKey("landing", params.job));
    if (!staged) throw new NonRetryableError("The staged image is gone (Staging clears after a day). Upload it again.");
    if (staged.bytes.byteLength > MAX_IMAGE_BYTES) throw new NonRetryableError(`Staged image exceeds the 8 MB cap (${staged.bytes.byteLength} bytes).`);
    return staged.bytes;
  }
  const response = await fetch(params.imageUrl, { redirect: "follow" });
  if ([401, 403, 404].includes(response.status)) {
    throw new NonRetryableError(
      `Image URL returned HTTP ${response.status} — the link is not publicly fetchable or has expired. ` +
        "Re-generate the image and provide its direct download URL.",
    );
  }
  if (!response.ok) throw new Error(`Image URL fetch failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) throw new NonRetryableError(`Image exceeds the 8 MB cap (content-length: ${declaredLength} bytes).`);
  const bytes = await readBodyWithCap(response, MAX_IMAGE_BYTES);
  if (bytes.byteLength === 0) throw new NonRetryableError("Image URL returned an empty body.");
  return bytes;
}

/**
 * Acquire, check, prepare and store — one step, because step results are
 * capped at 1 MiB and image bytes must not cross a step boundary. A re-run
 * after the store landed finds the key ready and stores nothing again.
 */
async function prepareAndStore(env: Env, params: CodLandingPageImageUploadParams): Promise<PreparedImage> {
  const bytes = await acquire(env, params);
  const sniffed = sniffImageType(bytes);
  const claimed = canonicalImageContentType(params.contentType);
  if (!sniffed) throw new NonRetryableError("The bytes are not a recognized image (png, jpeg, webp, or gif).");
  if (sniffed !== claimed) throw new NonRetryableError(`Content mismatch: the bytes are ${sniffed} but contentType claimed ${params.contentType}.`);

  const webp = sniffed === "image/webp" ? bytes : await transcodeToWebp(env, bytes);
  const stored = webp ?? bytes;
  const storedContentType = (webp ? "image/webp" : sniffed) as ImageType;
  const dimensions = parseImageDimensions(stored);
  const file = await mediaOf(env).store({
    key: `landing/${params.job}.${extensionOf(storedContentType)}`,
    contentType: storedContentType,
    body: stored,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  });
  return { key: file.key, size: file.bytes ?? stored.byteLength, storedContentType, converted: webp !== null };
}

export class CodLandingPageImageUploadWorkflow extends WorkflowEntrypoint<Env, CodLandingPageImageUploadParams> {
  async run(event: WorkflowEvent<CodLandingPageImageUploadParams>, step: WorkflowStep): Promise<CodLandingPageImageUploadOutput> {
    // Step 0 — runtime schema validation (params are untrusted input).
    const parsed = CodLandingPageImageUploadParamsSchema.safeParse(event.payload);
    if (!parsed.success) throw new NonRetryableError(`Invalid landing page image upload payload: ${formatIssues(parsed.error)}`);
    const params = parsed.data;

    // Step 1 — the file, prepared and kept.
    const prepared = await step.do(
      "prepare-and-store-image",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
      () => prepareAndStore(this.env, params),
    );

    // Step 2 — the landing_page_images row (idempotent on its key: an engine
    // restart after a committed insert re-runs this step and finds the row).
    const record = await step.do("insert-image-record", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, async () => {
      const db = getDb(this.env.DB);
      const delivery = mediaDeliveryOf(this.env);
      const landingPage = await getLandingPageRow(db, params.landingPageId);
      if (!landingPage) throw new NonRetryableError(`Landing page ${params.landingPageId} no longer exists — nothing to attach the image to.`);
      const ready = await mediaOf(this.env).ready(prepared.key);
      const shown = (await getLandingPageImages(db, params.landingPageId, delivery)).find((image) => image.key === prepared.key);
      const image =
        shown ??
        (
          await addLandingPageImage(
            db,
            params.landingPageId,
            { mediaKey: prepared.key, altText: params.altText ?? null, ...(params.position !== undefined ? { position: params.position } : {}), width: ready.width, height: ready.height, source: "ai" },
            delivery,
          )
        ).find((row) => row.key === prepared.key);
      if (!image) throw new Error(`Inserted image row for key ${prepared.key} not found in the resulting stack.`);
      return { imageId: image.id, url: image.url, position: image.position, width: image.width, height: image.height, altText: image.altText, landingPageName: landingPage.name };
    });

    // Step 3 — the staged bytes are no longer needed.
    if (params.kind === "bytes") {
      await step.do("clear-staging", () => staging(this.env.MEDIA_BUCKET).delete([stagingKey("landing", params.job)]));
    }

    // Step 4 — audit trail (best-effort: logActivity swallows its own errors,
    // so an audit failure can never fail an upload that already landed).
    await step.do("audit-image-added", async () => {
      await logActivity(
        getDb(this.env.DB),
        params.actor,
        ACTIONS.LANDING_PAGE_UPDATED,
        { type: "landing_page", id: params.landingPageId, label: record.landingPageName },
        {
          via: "mcp",
          action: "image_added",
          source: "ai",
          imageId: record.imageId,
          mediaKey: prepared.key,
          uploadKind: params.kind,
          uploadJobId: event.instanceId,
          byteSize: prepared.size,
          storedContentType: prepared.storedContentType,
          convertedToWebp: prepared.converted,
        },
      );
    });

    return {
      imageId: record.imageId,
      key: prepared.key,
      url: record.url,
      position: record.position,
      width: record.width,
      height: record.height,
      altText: record.altText,
      converted: prepared.converted,
      storedContentType: prepared.storedContentType,
    };
  }
}
