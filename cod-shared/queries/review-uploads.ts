/**
 * Review files kept before their review is written (reviews/media.ts): how
 * many a folder holds that no review shows yet, and the ones a review names,
 * read back from the Media Library's rows. Each query constrains `media` by
 * its key alone, so it is read through the unique key index and never through
 * the status index, which would visit every ready file of the store; status,
 * host and thumbnails are sorted out from the few rows found.
 */
import { and, gte, inArray, lt, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { media, reviewMedia } from "../db/schema";
import type { MediaHostKind } from "../media/model";
import { folderPrefix, isThumbKey, mediaIdOf, uploadKeys } from "../reviews/media";
import type { ReviewMediaKind } from "../reviews/model";

/** One upload, kept, as a review attaches it. */
export interface ReviewFile {
  id: string;
  kind: ReviewMediaKind;
  mediaKey: string;
  thumbKey: string | null;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

const unattached = sql`not exists (select 1 from ${reviewMedia} where ${reviewMedia.mediaKey} = ${media.key} or ${reviewMedia.thumbKey} = ${media.key})`;

/** The keys under `prefix`: from it to the same text with its last character raised by one. */
function underPrefix(prefix: string) {
  const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  return and(gte(media.key, prefix), lt(media.key, end));
}

/** How many uploads of each kind the folder holds that no review shows yet. */
export async function waitingUploads(db: AppDb, folder: string): Promise<Record<ReviewMediaKind, number>> {
  const rows = await db
    .select({ key: media.key, kind: media.kind, status: media.status })
    .from(media)
    .where(and(underPrefix(folderPrefix(folder)), unattached))
    .all();
  const counts: Record<ReviewMediaKind, number> = { image: 0, audio: 0 };
  for (const row of rows) {
    if (row.status === "ready" && !isThumbKey(row.key) && (row.kind === "image" || row.kind === "audio")) counts[row.kind] += 1;
  }
  return counts;
}

/** The most uploads one lookup takes: six keys each, inside D1's 100 bound parameters. */
export const MAX_UPLOADS_PER_LOOKUP = 15;

/**
 * The uploads `ids` of the folder, kept on `host` and shown by no review yet,
 * in the order given; `missing` names the first one that is not.
 */
export async function findUploads(db: AppDb, input: { folder: string; ids: readonly string[]; host: MediaHostKind }): Promise<{ files: ReviewFile[] } | { missing: string }> {
  if (input.ids.length === 0) return { files: [] };
  if (input.ids.length > MAX_UPLOADS_PER_LOOKUP) throw new RangeError(`At most ${MAX_UPLOADS_PER_LOOKUP} uploads are looked up at once`);
  const keys = input.ids.flatMap((id) => uploadKeys(input.folder, id));
  const rows = (await db.select().from(media).where(and(inArray(media.key, keys), unattached)).all()).filter(
    (row) => row.status === "ready" && row.host === input.host,
  );
  const files: ReviewFile[] = [];
  for (const id of input.ids) {
    const own = rows.filter((row) => mediaIdOf(row.key) === id);
    const main = own.find((row) => !isThumbKey(row.key));
    const thumb = own.find((row) => isThumbKey(row.key)) ?? null;
    if (!main || (main.kind !== "image" && main.kind !== "audio") || (main.kind === "image" && !thumb)) return { missing: id };
    files.push({
      id,
      kind: main.kind,
      mediaKey: main.key,
      thumbKey: main.kind === "image" ? thumb!.key : null,
      contentType: main.contentType,
      bytes: main.bytes ?? 0,
      width: main.width,
      height: main.height,
      durationMs: main.durationMs,
    });
  }
  return { files };
}

/** The `review_media` rows of a review's files, in the order sent. */
export function reviewMediaRows(reviewId: string, files: readonly ReviewFile[], createdAt: string) {
  return files.map((file, position) => ({
    id: file.id,
    reviewId,
    kind: file.kind,
    mediaKey: file.mediaKey,
    thumbKey: file.thumbKey,
    contentType: file.contentType,
    bytes: file.bytes,
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
    position,
    createdAt,
  }));
}

/** A review's files were attached by another review between reading and writing. */
export function isUploadTaken(error: unknown): boolean {
  return /UNIQUE constraint failed: review_media\.(media_key|thumb_key|id)/.test(`${(error as Error)?.message} ${(error as { cause?: unknown })?.cause ?? ""}`);
}
