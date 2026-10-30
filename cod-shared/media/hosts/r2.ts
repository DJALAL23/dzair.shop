/**
 * R2 as a Media Host. Two ways in, one per place that runs it:
 *
 * - `binding` — the store's own server, through its bucket binding. A
 *   browser's upload is relayed through the server; it serves the files
 *   itself for `direct` delivery (local development). No S3 keys, no CORS.
 * - `s3` — the Cloud, which edits a store from another account: S3 calls
 *   signed with the partner's R2 keys, and a browser PUT signed for one key,
 *   type and exact size.
 *
 * R2 keeps whatever type a request declares, so `confirm` reads a file's
 * first bytes and reports what they are.
 */
import { AwsClient } from "aws4fetch";
import { MediaError, hostFailure } from "../errors";
import { MEDIA_CACHE_CONTROL, sniffMedia, type MediaType } from "../keys";
import type { HostFile, HostObject, HostTicket, MediaHost } from "./host";

export interface R2S3Access {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type R2Config =
  | { binding: R2Bucket }
  | { s3: R2S3Access; fetch?: (request: Request) => Promise<Response>; endpoint?: string };

/** R2 deletes at most this many keys a call. */
const DELETE_BATCH = 1000;

const typeOf = (head: Uint8Array) => sniffMedia(head.subarray(0, 16))?.contentType ?? "application/octet-stream";

const unavailable = (error: unknown) =>
  new MediaError("host_unavailable", "R2 could not be reached", { error: error instanceof Error ? error.message : String(error) });

export function r2Host(config: R2Config): MediaHost {
  return "binding" in config ? bindingHost(config.binding) : s3Host(config.s3, config.fetch ?? ((request) => fetch(request)), config.endpoint);
}

function bindingHost(bucket: R2Bucket): MediaHost {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw error instanceof MediaError ? error : unavailable(error);
    }
  };

  return {
    kind: "r2",

    async ticket(): Promise<HostTicket> {
      return { kind: "relay" };
    },

    confirm: (key) =>
      guard(async () => {
        const object = await bucket.get(key, { range: { offset: 0, length: 16 } });
        if (object === null) return null;
        return { hostRef: null, bytes: object.size, contentType: typeOf(new Uint8Array(await object.arrayBuffer())), width: null, height: null };
      }),

    put: ({ key, contentType, body }) =>
      guard(async () => {
        await bucket.put(key, body, { httpMetadata: { contentType, cacheControl: MEDIA_CACHE_CONTROL } });
        return { hostRef: null, bytes: body.byteLength, contentType, width: null, height: null };
      }),

    delete: (files) =>
      guard(async () => {
        const keys = files.map((file) => file.key);
        for (let i = 0; i < keys.length; i += DELETE_BATCH) await bucket.delete(keys.slice(i, i + DELETE_BATCH));
      }),

    open: (key) =>
      guard(async (): Promise<HostObject | null> => {
        const object = await bucket.get(key);
        if (object === null) return null;
        return { body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", bytes: object.size, etag: object.httpEtag };
      }),
  };
}

function s3Host(access: R2S3Access, send: (request: Request) => Promise<Response>, endpoint?: string): MediaHost {
  const client = new AwsClient({ accessKeyId: access.accessKeyId, secretAccessKey: access.secretAccessKey, service: "s3", region: "auto" });
  const base = endpoint ?? `https://${access.accountId}.r2.cloudflarestorage.com`;
  const objectUrl = (key: string) => `${base}/${access.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function call(request: Promise<Request>, allow: readonly number[] = []): Promise<Response> {
    let response: Response;
    try {
      response = await send(await request);
    } catch (error) {
      throw unavailable(error);
    }
    if (response.ok || allow.includes(response.status)) return response;
    throw new MediaError(hostFailure(response.status), `R2 answered ${response.status}`, { status: response.status });
  }

  return {
    kind: "r2",

    async ticket({ key, contentType, bytes, expiresAt }): Promise<HostTicket> {
      const now = new Date();
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))));
      const headers = { "Content-Type": contentType, "Cache-Control": MEDIA_CACHE_CONTROL };
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers: { ...headers, "Content-Length": String(bytes) },
        aws: { signQuery: true, allHeaders: true, datetime: now.toISOString().replace(/[:-]|\.\d{3}/g, "") },
      });
      return { kind: "put", url: signed.url, headers };
    },

    async confirm(key): Promise<HostFile | null> {
      const response = await call(client.sign(objectUrl(key), { method: "GET", headers: { Range: "bytes=0-15" } }), [404]);
      if (response.status === 404) return null;
      const total = /\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "")?.[1] ?? response.headers.get("Content-Length");
      return { hostRef: null, bytes: Number(total ?? 0), contentType: typeOf(new Uint8Array(await response.arrayBuffer())), width: null, height: null };
    },

    async put({ key, contentType, body }: { key: string; contentType: MediaType; body: Uint8Array<ArrayBuffer> }) {
      await call(client.sign(objectUrl(key), { method: "PUT", headers: { "Content-Type": contentType, "Cache-Control": MEDIA_CACHE_CONTROL }, body: body as BodyInit }));
      return { hostRef: null, bytes: body.byteLength, contentType, width: null, height: null };
    },

    async delete(files) {
      for (const file of files) await call(client.sign(objectUrl(file.key), { method: "DELETE" }), [404]);
    },
  };
}
