/**
 * Receiving one review file — a shopper's under their grant, or a merchant's
 * for a review they enter: read while counting (never past the limit), typed
 * by its bytes, checked against what may be attached, and stored as sent
 * in Staging, `staging/reviews/<folder>/<upload>`, until the review's media
 * job prepares it (or the bucket's lifecycle rule clears it).
 */
import { BusinessLogicError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { newMediaId, uploadKey, uploadPrefix } from "../../../../cod-shared/reviews/media";
import { sniffMedia } from "../../../../cod-shared/media/keys";
import { readCapped } from "../../../../cod-shared/media/stream";
import { REVIEW_PHOTO_MAX_BYTES, voiceMaxBytes } from "../../../../cod-shared/reviews/policy";
import type { ReviewMediaKind, ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import type { Staging } from "@/lib/staging";

export interface FileAllowance {
  /** 0 = no photos. */
  maxPhotos: number;
  /** null = no voice note. */
  voiceMaxSeconds: number | null;
}

export interface ReceivedFile {
  uploadId: string;
  kind: ReviewMediaKind;
  bytes: number;
}

export async function receiveFile(
  staging: Pick<Staging, "list" | "put">,
  input: {
    folder: string;
    body: ReadableStream<Uint8Array> | null;
    declaredBytes?: number;
    declaredDurationMs?: number;
    allowance: FileAllowance;
    /** How many files of each kind the folder may hold (a shopper may re-send one they removed). */
    folderLimit: Record<ReviewMediaKind, number>;
    metadata?: Record<string, string>;
  },
): Promise<ReceivedFile> {
  const { allowance } = input;
  const voiceCap = allowance.voiceMaxSeconds ? voiceMaxBytes(allowance.voiceMaxSeconds as ReviewVoiceLength) : 0;
  const photoCap = allowance.maxPhotos > 0 ? REVIEW_PHOTO_MAX_BYTES : 0;
  const cap = Math.max(voiceCap, photoCap);
  const tooLarge = () => new ValidationError("This file is too large", ERROR_CODES.FILE_TOO_LARGE, { maxBytes: cap });
  if (!input.body) throw new ValidationError("No file was sent", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  if (input.declaredBytes !== undefined && input.declaredBytes > cap) throw tooLarge();

  const bytes = await readCapped(input.body, cap);
  if (!bytes) throw tooLarge();
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty", ERROR_CODES.REQUIRED_FIELD_MISSING, { field: "body" });
  const sniffed = sniffMedia(bytes.subarray(0, 16));
  if (!sniffed) throw new ValidationError("Send a photo (JPEG, PNG, WebP) or a voice note (WebM, Ogg, M4A, MP3)", ERROR_CODES.INVALID_FILE_TYPE);

  const allowed = sniffed.kind === "image" ? allowance.maxPhotos > 0 : allowance.voiceMaxSeconds !== null;
  if (!allowed) {
    throw new BusinessLogicError(sniffed.kind === "image" ? "Photos are not taken with these reviews" : "Voice notes are not taken with these reviews", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max: 0 });
  }
  if (bytes.byteLength > (sniffed.kind === "image" ? photoCap : voiceCap)) throw tooLarge();

  const already = (await staging.list(uploadPrefix(input.folder))).filter((file) => file.custom.kind === sniffed.kind).length;
  const max = input.folderLimit[sniffed.kind];
  if (already >= max) throw new BusinessLogicError("Too many files sent for this review", ERROR_CODES.REVIEW_MEDIA_LIMIT, { kind: sniffed.kind, max });

  const uploadId = newMediaId();
  await staging.put(uploadKey(input.folder, uploadId), bytes, {
    contentType: sniffed.contentType,
    custom: {
      ...input.metadata,
      kind: sniffed.kind,
      contentType: sniffed.contentType,
      ...(sniffed.kind === "audio" && input.declaredDurationMs !== undefined ? { declaredDurationMs: String(input.declaredDurationMs) } : {}),
    },
  });
  return { uploadId, kind: sniffed.kind, bytes: bytes.byteLength };
}

/** The uploads a review names, as stored; throws when one was never received. */
export async function findReceived(staging: Pick<Staging, "head">, folder: string, uploadIds: string[]) {
  const heads = await Promise.all(uploadIds.map((id) => staging.head(uploadKey(folder, id))));
  return heads.map((head, i) => {
    const kind = head?.custom.kind;
    if (!head || (kind !== "image" && kind !== "audio")) {
      throw new BusinessLogicError("A file of this review was not received — send it again", ERROR_CODES.REVIEW_UPLOAD_NOT_FOUND, { uploadId: uploadIds[i] });
    }
    const declared = Number(head.custom.declaredDurationMs);
    return {
      key: head.key,
      kind: kind as ReviewMediaKind,
      contentType: head.custom.contentType ?? head.contentType ?? "application/octet-stream",
      bytes: head.size,
      ...(Number.isInteger(declared) && declared > 0 ? { declaredDurationMs: declared } : {}),
    };
  });
}
