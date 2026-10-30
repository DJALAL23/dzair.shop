/**
 * The seam between the Media Library and a Media Host. The library is the
 * only caller: it decides keys, sizes and types and keeps the `media` rows;
 * a host only moves bytes and reports what it holds. Every host passes the
 * same suite (`contract.ts`).
 */
import type { MediaType } from "../keys";
import type { MediaHostKind } from "../model";

/** How a browser sends one file, as a host signs it. */
export type HostTicket =
  /** A multipart POST of `fields` plus the file as `fileField`. */
  | { kind: "form"; url: string; fields: Record<string, string>; fileField: string }
  /** A PUT of the file's bytes with exactly these headers. */
  | { kind: "put"; url: string; headers: Record<string, string> }
  /** The bytes go through the store's server, which stores them with `put`. */
  | { kind: "relay" };

/** What a host holds for one key. */
export interface HostFile {
  /** The host's own id for the file, when it has one. */
  hostRef: string | null;
  bytes: number;
  contentType: string;
  width: number | null;
  height: number | null;
}

/** A stored file as a host serves it to the store's own server (`direct` delivery). */
export interface HostObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  bytes: number;
  etag: string;
}

export interface MediaHost {
  readonly kind: MediaHostKind;

  /** Sign one browser upload of `bytes` bytes of `contentType` to `key`, good until `expiresAt`. */
  ticket(upload: { key: string; contentType: MediaType; bytes: number; expiresAt: Date }): Promise<HostTicket>;

  /** What the host holds at `key` (found by `hostRef` when there is one), or null. */
  confirm(key: string, hostRef: string | null): Promise<HostFile | null>;

  /** Store bytes at `key`, replacing what is there. */
  put(object: { key: string; contentType: MediaType; body: Uint8Array<ArrayBuffer> }): Promise<HostFile>;

  /** Delete these files; one already gone counts as deleted. */
  delete(files: ReadonlyArray<{ key: string; hostRef: string | null }>): Promise<void>;

  /** The file's bytes, for a host the store's server serves itself; absent on hosts that deliver on their own. */
  open?(key: string): Promise<HostObject | null>;
}
