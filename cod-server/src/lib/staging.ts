/**
 * Staging (cod-shared/media/CONTEXT.md): the store's private area of its own
 * bucket for files that must be prepared before they are kept — a shopper's
 * review files, an AI agent's landing images. Never served; the bucket's
 * lifecycle rule clears `staging/` after a day, so a file never prepared
 * costs nothing to clean. It reaches only keys under `staging/`: the files
 * the store keeps are the Media Library's.
 */
export const STAGING_PREFIX = "staging/";

export function stagingKey(area: "landing" | "reviews", ...parts: string[]): string {
  return `${STAGING_PREFIX}${area}/${parts.join("/")}`;
}

export interface StagedFile {
  key: string;
  size: number;
  contentType: string | null;
  custom: Record<string, string>;
}

function staged(key: string): string {
  if (!key.startsWith(STAGING_PREFIX)) throw new Error(`Not a Staging key: ${key}`);
  return key;
}

export function staging(bucket: R2Bucket) {
  return {
    async put(key: string, bytes: Uint8Array, metadata: { contentType: string; custom?: Record<string, string> }): Promise<void> {
      await bucket.put(staged(key), bytes, { httpMetadata: { contentType: metadata.contentType }, customMetadata: metadata.custom });
    },
    async read(key: string): Promise<(StagedFile & { bytes: Uint8Array }) | null> {
      const object = await bucket.get(staged(key));
      if (object === null) return null;
      return { key: object.key, size: object.size, contentType: object.httpMetadata?.contentType ?? null, custom: object.customMetadata ?? {}, bytes: new Uint8Array(await object.arrayBuffer()) };
    },
    async head(key: string): Promise<StagedFile | null> {
      const object = await bucket.head(staged(key));
      if (object === null) return null;
      return { key: object.key, size: object.size, contentType: object.httpMetadata?.contentType ?? null, custom: object.customMetadata ?? {} };
    },
    async list(prefix: string): Promise<StagedFile[]> {
      const found: StagedFile[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: staged(prefix), cursor, include: ["customMetadata", "httpMetadata"] });
        for (const object of page.objects) found.push({ key: object.key, size: object.size, contentType: object.httpMetadata?.contentType ?? null, custom: object.customMetadata ?? {} });
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return found;
    },
    async delete(keys: readonly string[]): Promise<void> {
      if (keys.length > 0) await bucket.delete(keys.map(staged));
    },
  };
}

export type Staging = ReturnType<typeof staging>;
