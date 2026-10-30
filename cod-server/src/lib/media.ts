/**
 * The store's Media Library from its configuration (ADR 0021): MEDIA_HOST
 * picks where files are kept, MEDIA_DELIVERY and MEDIA_ORIGIN how browsers
 * fetch them. A missing or wrong value is MEDIA_NOT_CONFIGURED — there is no
 * default host.
 */
import { getDb } from "@/db";
import { AppError } from "@/lib/errors/classes";
import type { Env } from "@/types/env";
import { ERROR_CATEGORIES, ERROR_CODES, type ErrorCategory, type ErrorCode } from "../../../cod-shared/errors/codes";
import { mediaDelivery, type MediaDelivery } from "../../../cod-shared/media/delivery";
import { MediaError, type MediaErrorReason } from "../../../cod-shared/media/errors";
import type { MediaHost } from "../../../cod-shared/media/hosts/host";
import { imagekitHost } from "../../../cod-shared/media/hosts/imagekit";
import { r2Host } from "../../../cod-shared/media/hosts/r2";
import { mediaLibrary, type MediaLibrary } from "../../../cod-shared/media/library";
import { MEDIA_HOSTS } from "../../../cod-shared/media/model";

/** Where a browser PUTs a relayed upload: the route in `endpoints/media`. */
export const relayPath = (mediaId: string) => `/api/media/uploads/${mediaId}/content`;

export function mediaHostOf(env: Env): MediaHost {
  switch (env.MEDIA_HOST) {
    case "imagekit":
      return imagekitHost({ publicKey: env.IMAGEKIT_PUBLIC_KEY ?? "", privateKey: env.IMAGEKIT_PRIVATE_KEY ?? "", folder: env.IMAGEKIT_FOLDER ?? "" });
    case "r2":
      return r2Host({ binding: env.MEDIA_BUCKET });
    default:
      throw new MediaError("not_configured", `MEDIA_HOST must be one of ${MEDIA_HOSTS.join(", ")}`, { value: env.MEDIA_HOST ?? null });
  }
}

export function mediaDeliveryOf(env: Env): MediaDelivery {
  return mediaDelivery(env.MEDIA_DELIVERY, env.MEDIA_ORIGIN);
}

export function mediaOf(env: Env): MediaLibrary {
  return mediaLibrary({ db: getDb(env.DB), host: mediaHostOf(env), delivery: mediaDeliveryOf(env), relayUrl: relayPath });
}

/**
 * Release keys a committed change no longer shows, for a caller whose change
 * already stands: when the host cannot delete now, the files stay with their
 * rows and the sweep forgets them later. Answers how many were deleted.
 */
export async function releaseShown(env: Env, keys: readonly string[], what: string): Promise<number> {
  if (keys.length === 0) return 0;
  try {
    return (await mediaOf(env).release(keys)).released.length;
  } catch (error) {
    if (!(error instanceof MediaError)) throw error;
    console.error(`[media] ${what}: ${keys.length} file(s) not released now (${error.reason}); the sweep forgets them`, error.message);
    return 0;
  }
}

const ANSWERS: Record<MediaErrorReason, { status: number; code: ErrorCode; category: ErrorCategory }> = {
  not_configured: { status: 503, code: ERROR_CODES.MEDIA_NOT_CONFIGURED, category: ERROR_CATEGORIES.SYSTEM },
  type_refused: { status: 400, code: ERROR_CODES.INVALID_FILE_TYPE, category: ERROR_CATEGORIES.VALIDATION },
  too_large: { status: 400, code: ERROR_CODES.FILE_TOO_LARGE, category: ERROR_CATEGORIES.VALIDATION },
  folder_refused: { status: 400, code: ERROR_CODES.VALIDATION_FAILED, category: ERROR_CATEGORIES.VALIDATION },
  key_invalid: { status: 400, code: ERROR_CODES.MEDIA_KEY_INVALID, category: ERROR_CATEGORIES.VALIDATION },
  not_ready: { status: 409, code: ERROR_CODES.MEDIA_NOT_READY, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  upload_unknown: { status: 404, code: ERROR_CODES.MEDIA_UPLOAD_UNKNOWN, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  upload_missing: { status: 409, code: ERROR_CODES.MEDIA_UPLOAD_MISSING, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  upload_mismatch: { status: 422, code: ERROR_CODES.MEDIA_UPLOAD_MISMATCH, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  host_refused: { status: 502, code: ERROR_CODES.MEDIA_HOST_REFUSED, category: ERROR_CATEGORIES.SYSTEM },
  host_unavailable: { status: 503, code: ERROR_CODES.MEDIA_HOST_UNAVAILABLE, category: ERROR_CATEGORIES.SYSTEM },
};

/** The server's answer for a Media Library refusal or failure. */
export function mediaAppError(error: MediaError): AppError {
  const { status, code, category } = ANSWERS[error.reason];
  return new AppError(error.message, code, category, status, { ...error.details, retryable: error.retryable });
}
