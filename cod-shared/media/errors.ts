/**
 * Why the Media module refused or failed. Callers map a reason to their own
 * answer (cod-server: an error code and an HTTP status); `retryable` says
 * whether the same call may succeed later.
 */

export type MediaErrorReason =
  /** The store's media configuration is missing or wrong. */
  | "not_configured"
  /** A content type the store does not keep, or a file whose bytes are not what it claims. */
  | "type_refused"
  /** Larger than a ticket allows, or than the ticket said. */
  | "too_large"
  /** A folder a browser may not upload into. */
  | "folder_refused"
  /** Not a Media Key. */
  | "key_invalid"
  /** No pending upload has this id. */
  | "upload_unknown"
  /** The host does not hold the file the upload should have sent. */
  | "upload_missing"
  /** The host holds a file, but not the one the ticket was for. */
  | "upload_mismatch"
  /** The host refused the request: credentials, plan, or a request it will never accept. */
  | "host_refused"
  /** The host could not answer now: rate limit, outage, network. */
  | "host_unavailable";

const RETRYABLE: ReadonlySet<MediaErrorReason> = new Set(["host_unavailable"]);

export class MediaError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly reason: MediaErrorReason,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MediaError";
    this.retryable = RETRYABLE.has(reason);
  }
}

/** The reason a host's HTTP status means. */
export function hostFailure(status: number): MediaErrorReason {
  return status === 408 || status === 429 || status >= 500 ? "host_unavailable" : "host_refused";
}
