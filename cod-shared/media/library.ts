/**
 * The Media Library: the only way the platform keeps, shows and forgets a
 * store's files (ADR 0021, CONTEXT.md). It owns the `media` rows; its host
 * owns the bytes. A browser's upload is pending until the host confirms it,
 * and nothing is deleted while stored data still shows it.
 */
import { and, desc, eq, inArray, like, lt, or } from "drizzle-orm";
import type { StoreDb } from "../db/client";
import { media } from "../db/schema";
import { mediaImage, mediaUrl, type MediaDelivery } from "./delivery";
import { MediaError } from "./errors";
import type { HostFile, HostObject, MediaHost } from "./hosts/host";
import {
  MEDIA_MAX_BYTES,
  UPLOAD_TICKET_SECONDS,
  isImageType,
  isMediaKey,
  isMediaType,
  isUploadFolder,
  mediaKindOf,
  newMediaKey,
  sniffMedia,
  type MediaType,
  type UploadFolder,
} from "./keys";
import type { MediaImage } from "./model";
import { shownKeys } from "./references";
import { readCapped } from "./stream";

export type StoredMedia = typeof media.$inferSelect;

/** How a browser sends the file of an Upload Ticket. */
export type UploadSend =
  | { kind: "form"; method: "POST"; url: string; fields: Record<string, string>; fileField: string }
  | { kind: "put"; method: "PUT"; url: string; headers: Record<string, string> }
  | { kind: "relay"; method: "PUT"; url: string; headers: Record<string, string> };

export interface UploadTicket {
  mediaId: string;
  key: string;
  expiresAt: string;
  send: UploadSend;
}

export interface SweepReport {
  dryRun: boolean;
  /** Rows old enough to be considered. */
  scanned: number;
  /** Those nothing shows. */
  orphans: Array<{ key: string; status: StoredMedia["status"]; bytes: number | null; createdAt: string }>;
  deleted: number;
}

export interface MediaLibraryConfig {
  db: StoreDb;
  host: MediaHost;
  delivery: MediaDelivery;
  /** Where a browser PUTs a relayed upload's bytes: the store server's route for `mediaId`. Required by a host that relays. */
  relayUrl?: (mediaId: string) => string;
  now?: () => Date;
}

/** D1 binds at most 100 parameters a statement. */
const PARAMS_PER_STATEMENT = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export function mediaLibrary(config: MediaLibraryConfig) {
  const { db, host, delivery } = config;
  const now = config.now ?? (() => new Date());

  async function byId(id: string): Promise<StoredMedia | null> {
    return (await db.select().from(media).where(eq(media.id, id)).get()) ?? null;
  }

  async function byKey(key: string): Promise<StoredMedia | null> {
    return (await db.select().from(media).where(eq(media.key, key)).get()) ?? null;
  }

  async function rowsOf(keys: readonly string[]): Promise<StoredMedia[]> {
    const rows: StoredMedia[] = [];
    for (const part of chunks(keys, PARAMS_PER_STATEMENT)) rows.push(...(await db.select().from(media).where(inArray(media.key, part)).all()));
    return rows;
  }

  async function markReady(row: StoredMedia, file: HostFile, hints: { width?: number | null; height?: number | null } = {}): Promise<StoredMedia> {
    await db
      .update(media)
      .set({
        status: "ready",
        hostRef: file.hostRef,
        bytes: file.bytes,
        width: file.width ?? hints.width ?? null,
        height: file.height ?? hints.height ?? null,
        readyAt: now().toISOString(),
      })
      .where(and(eq(media.id, row.id), eq(media.status, "pending")));
    return (await byId(row.id))!;
  }

  /** Delete these rows' files from the host, then the rows; a host failure keeps every row. */
  async function forget(rows: readonly StoredMedia[]): Promise<void> {
    if (rows.length === 0) return;
    await host.delete(rows.map((row) => ({ key: row.key, hostRef: row.hostRef })));
    for (const part of chunks(rows.map((row) => row.id), PARAMS_PER_STATEMENT)) await db.delete(media).where(inArray(media.id, part));
  }

  async function uploadRow(mediaId: string): Promise<StoredMedia> {
    const row = await byId(mediaId);
    if (row === null || row.host !== host.kind) throw new MediaError("upload_unknown", "No upload has this id", { mediaId });
    return row;
  }

  const image = (row: StoredMedia): MediaImage => mediaImage(row, delivery);

  return {
    /** The URL of a stored key. */
    url: (key: string) => mediaUrl(key, delivery),

    /** A stored row as the API returns it. */
    image,

    /** The ready file at `key`, for a caller about to show it: refused (`not_ready`) when there is none, it is pending, or another host keeps it. */
    async ready(key: string): Promise<StoredMedia> {
      if (!isMediaKey(key)) throw new MediaError("key_invalid", "Not a Media Key", { key });
      const row = await byKey(key);
      if (row === null || row.status !== "ready" || row.host !== host.kind) throw new MediaError("not_ready", "No ready image has this key; complete its upload first", { key });
      return row;
    },

    /** Ticket one browser upload of `bytes` bytes of `contentType` into `folder`; its row is pending until `completeUpload` confirms it. */
    async requestUpload(upload: { folder: UploadFolder; contentType: string; bytes: number }): Promise<UploadTicket> {
      if (!isUploadFolder(upload.folder)) throw new MediaError("folder_refused", "A browser uploads into products or landing only", { folder: upload.folder });
      if (!isImageType(upload.contentType)) throw new MediaError("type_refused", "An image is jpg, png, webp or gif", { contentType: upload.contentType });
      if (!Number.isInteger(upload.bytes) || upload.bytes < 1 || upload.bytes > MEDIA_MAX_BYTES) {
        throw new MediaError("too_large", `An image is at most ${MEDIA_MAX_BYTES / 1024 / 1024} MB`, { bytes: upload.bytes, maxBytes: MEDIA_MAX_BYTES });
      }
      const id = crypto.randomUUID().replace(/-/g, "");
      const key = newMediaKey(upload.folder, upload.contentType);
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + UPLOAD_TICKET_SECONDS * 1000);
      const signed = await host.ticket({ key, contentType: upload.contentType, bytes: upload.bytes, expiresAt });
      let send: UploadSend;
      if (signed.kind === "relay") {
        if (!config.relayUrl) throw new MediaError("not_configured", "This host relays uploads, and no relay route was given");
        send = { kind: "relay", method: "PUT", url: config.relayUrl(id), headers: { "Content-Type": upload.contentType } };
      } else {
        send = signed.kind === "form" ? { ...signed, method: "POST" } : { ...signed, method: "PUT" };
      }
      await db.insert(media).values({
        id,
        key,
        host: host.kind,
        hostRef: null,
        kind: "image",
        contentType: upload.contentType,
        bytes: upload.bytes,
        width: null,
        height: null,
        status: "pending",
        createdAt: createdAt.toISOString(),
        readyAt: null,
      });
      return { mediaId: id, key, expiresAt: expiresAt.toISOString(), send };
    },

    /**
     * The bytes of a relayed upload, sent by the browser to the store's server:
     * capped at the ticket's size, typed by their bytes, and stored. The upload
     * is ready once `completeUpload` confirms it, as for every ticket.
     */
    async receive(mediaId: string, body: ReadableStream<Uint8Array> | null): Promise<void> {
      const row = await uploadRow(mediaId);
      if (row.status === "ready") return;
      if (now().getTime() > Date.parse(row.createdAt) + UPLOAD_TICKET_SECONDS * 1000) throw new MediaError("upload_unknown", "This upload's ticket has expired", { mediaId });
      if (body === null) throw new MediaError("upload_missing", "No file was sent", { mediaId });
      const bytes = await readCapped(body, row.bytes ?? 0);
      if (bytes === null) throw new MediaError("too_large", "The file is larger than its ticket", { mediaId, maxBytes: row.bytes });
      if (bytes.byteLength === 0) throw new MediaError("upload_missing", "The file is empty", { mediaId });
      if (sniffMedia(bytes.subarray(0, 16))?.contentType !== row.contentType) throw new MediaError("type_refused", "The file is not the type its ticket was for", { mediaId, contentType: row.contentType });
      await host.put({ key: row.key, contentType: row.contentType as MediaType, body: bytes });
    },

    /**
     * A browser's upload, confirmed with the host: ready when the host holds
     * the ticket's file, no larger and of the same type. A wrong file is
     * deleted with its row, so the browser starts again with a new ticket.
     * Measurements the host does not report come from the browser.
     */
    async completeUpload(mediaId: string, report: { hostRef?: string | null; width?: number | null; height?: number | null } = {}): Promise<MediaImage> {
      const row = await uploadRow(mediaId);
      if (row.status === "ready") return image(row);
      const file = await host.confirm(row.key, report.hostRef ?? null);
      if (file === null) throw new MediaError("upload_missing", "The host does not hold this upload's file", { mediaId, key: row.key });
      if (file.bytes > (row.bytes ?? 0) || file.contentType !== row.contentType) {
        await forget([{ ...row, hostRef: file.hostRef }]);
        throw new MediaError("upload_mismatch", "The uploaded file is not the one its ticket was for", { mediaId, bytes: file.bytes, contentType: file.contentType });
      }
      return image(await markReady(row, file, report));
    },

    /**
     * Keep bytes the server itself writes: at `key` (a review file, a starter
     * picture) or under a fresh key in `folder`. A key already ready is kept
     * as it is — a key never holds other bytes — so a retried write is safe.
     */
    async store(file: { key?: string; folder?: UploadFolder; contentType: string; body: Uint8Array<ArrayBuffer>; width?: number | null; height?: number | null }): Promise<StoredMedia> {
      if (!isMediaType(file.contentType)) throw new MediaError("type_refused", "Not a type the store keeps", { contentType: file.contentType });
      if (sniffMedia(file.body.subarray(0, 16))?.contentType !== file.contentType) throw new MediaError("type_refused", "The bytes are not the type given", { contentType: file.contentType });
      let key: string;
      if (file.key !== undefined) {
        if (!isMediaKey(file.key)) throw new MediaError("key_invalid", "Not a Media Key", { key: file.key });
        key = file.key;
      } else {
        if (!isUploadFolder(file.folder) || !isImageType(file.contentType)) throw new MediaError("folder_refused", "A fresh key is an image in products or landing", { folder: file.folder ?? null });
        key = newMediaKey(file.folder, file.contentType);
      }
      const existing = await byKey(key);
      if (existing?.status === "ready") return existing;
      if (existing === null) {
        await db
          .insert(media)
          .values({
            id: crypto.randomUUID().replace(/-/g, ""),
            key,
            host: host.kind,
            hostRef: null,
            kind: mediaKindOf(file.contentType),
            contentType: file.contentType,
            bytes: file.body.byteLength,
            width: null,
            height: null,
            status: "pending",
            createdAt: now().toISOString(),
            readyAt: null,
          })
          .onConflictDoNothing({ target: media.key });
      }
      const stored = await host.put({ key, contentType: file.contentType, body: file.body });
      return markReady((await byKey(key))!, stored, file);
    },

    /**
     * The caller no longer shows these keys: the files nothing else shows
     * are deleted from the host, then their rows. Keys the library does not
     * hold, or another host holds, are kept.
     */
    async release(keys: readonly string[]): Promise<{ released: string[]; kept: string[] }> {
      const wanted = [...new Set(keys.filter(isMediaKey))];
      const rows = (await rowsOf(wanted)).filter((row) => row.host === host.kind);
      const shown = await shownKeys(db, rows.map((row) => row.key));
      const gone = rows.filter((row) => !shown.has(row.key));
      await forget(gone);
      const released = new Set(gone.map((row) => row.key));
      return { released: [...released], kept: keys.filter((key) => !released.has(key)) };
    },

    /**
     * Forget what was never finished or is no longer shown: pending rows older
     * than a day, ready rows older than `readyOlderThanDays` that nothing
     * shows. A dry run (the default) only reports.
     */
    async sweep(options: { dryRun?: boolean; readyOlderThanDays?: number; limit?: number } = {}): Promise<SweepReport> {
      const { dryRun = true, readyOlderThanDays = 30, limit = 500 } = options;
      const at = now().getTime();
      const candidates = await db
        .select()
        .from(media)
        .where(
          and(
            eq(media.host, host.kind),
            or(
              and(eq(media.status, "pending"), lt(media.createdAt, new Date(at - DAY_MS).toISOString())),
              and(eq(media.status, "ready"), lt(media.createdAt, new Date(at - readyOlderThanDays * DAY_MS).toISOString())),
            ),
          ),
        )
        .orderBy(media.createdAt)
        .limit(limit)
        .all();
      const shown = await shownKeys(db, candidates.map((row) => row.key));
      const orphans = candidates.filter((row) => !shown.has(row.key));
      if (!dryRun) await forget(orphans);
      return {
        dryRun,
        scanned: candidates.length,
        orphans: orphans.map((row) => ({ key: row.key, status: row.status, bytes: row.bytes, createdAt: row.createdAt })),
        deleted: dryRun ? 0 : orphans.length,
      };
    },

    /** The store's ready images in `folder`, newest first; `after` continues from the last page's `next`. */
    async list(options: { folder: UploadFolder; after?: string | null; limit?: number }): Promise<{ items: Array<MediaImage & { createdAt: string }>; next: string | null }> {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      const [afterAt, afterId] = options.after?.split("|") ?? [];
      const rows = await db
        .select()
        .from(media)
        .where(
          and(
            eq(media.host, host.kind),
            eq(media.status, "ready"),
            eq(media.kind, "image"),
            like(media.key, `${options.folder}/%`),
            afterAt !== undefined && afterId !== undefined ? or(lt(media.createdAt, afterAt), and(eq(media.createdAt, afterAt), lt(media.id, afterId))) : undefined,
          ),
        )
        .orderBy(desc(media.createdAt), desc(media.id))
        .limit(limit + 1)
        .all();
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({ ...image(row), createdAt: row.createdAt })),
        next: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
      };
    },

    /**
     * A ready file's bytes, for a host the store's server serves itself
     * (`direct` delivery); null for any other file, and on any other host.
     */
    async open(key: string): Promise<HostObject | null> {
      if (!isMediaKey(key) || !host.open) return null;
      const row = await byKey(key);
      return row?.status === "ready" && row.host === host.kind ? host.open(key) : null;
    },
  };
}

export type MediaLibrary = ReturnType<typeof mediaLibrary>;
