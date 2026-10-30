/**
 * ImageKit as a Media Host (ADR 0021). A store's keys live under its folder
 * in the account (`<folder>/<key>`), so one account can hold many stores.
 *
 * A browser uploads with upload V2: a one-use JWT (HS256, `kid` = the public
 * key) signed over exactly the fields it sends — name, folder, no renaming,
 * no overwriting, and checks on size and type — so it can write nothing
 * else. The server's own writes use the private key (Basic auth). ImageKit
 * deletes by `fileId`; a file uploaded but never confirmed has none recorded
 * and is found by its exact path.
 */
import { MediaError, hostFailure } from "../errors";
import type { MediaType } from "../keys";
import type { HostFile, HostTicket, MediaHost } from "./host";

export interface ImageKitConfig {
  publicKey: string;
  privateKey: string;
  /** The store's root in the account, e.g. `/stores/maysa`; `/` for the account's root. */
  folder: string;
  fetch?: (request: Request) => Promise<Response>;
  uploadOrigin?: string;
  apiOrigin?: string;
}

/** ImageKit deletes at most this many files a call. */
const DELETE_BATCH = 100;
const FOLDER_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface ImageKitFile {
  fileId: string;
  filePath: string;
  size: number;
  mime?: string;
  width?: number | null;
  height?: number | null;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function jwt(header: Record<string, string>, payload: Record<string, string | number>, secret: string): Promise<string> {
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)));
  return `${signingInput}.${base64url(signature)}`;
}

function storeFolder(folder: string): string {
  if (!folder.startsWith("/")) throw new MediaError("not_configured", "IMAGEKIT_FOLDER must start with /", { value: folder });
  const segments = folder.split("/").filter((segment) => segment !== "");
  if (!segments.every((segment) => FOLDER_SEGMENT.test(segment))) throw new MediaError("not_configured", "IMAGEKIT_FOLDER has a segment ImageKit paths cannot hold", { value: folder });
  return segments.map((segment) => `/${segment}`).join("");
}

export function imagekitHost(config: ImageKitConfig): MediaHost {
  if (!config.publicKey) throw new MediaError("not_configured", "IMAGEKIT_PUBLIC_KEY is missing");
  if (!config.privateKey) throw new MediaError("not_configured", "IMAGEKIT_PRIVATE_KEY is missing");
  const root = storeFolder(config.folder);
  const send = config.fetch ?? ((request: Request) => fetch(request));
  const uploadOrigin = config.uploadOrigin ?? "https://upload.imagekit.io";
  const apiOrigin = config.apiOrigin ?? "https://api.imagekit.io";
  const authorization = `Basic ${btoa(`${config.privateKey}:`)}`;

  const placeOf = (key: string) => {
    const at = key.lastIndexOf("/");
    return { folder: `${root}/${key.slice(0, at)}`, fileName: key.slice(at + 1), filePath: `${root}/${key}` };
  };

  async function call(request: Request, allow: readonly number[] = []): Promise<Response> {
    let response: Response;
    try {
      response = await send(request);
    } catch (error) {
      throw new MediaError("host_unavailable", "ImageKit could not be reached", { error: error instanceof Error ? error.message : String(error) });
    }
    if (response.ok || allow.includes(response.status)) return response;
    const message = await response
      .json()
      .then((body) => (body as { message?: string }).message)
      .catch(() => undefined);
    throw new MediaError(hostFailure(response.status), `ImageKit answered ${response.status}${message ? `: ${message}` : ""}`, { status: response.status });
  }

  const api = (path: string, init: RequestInit = {}) =>
    new Request(`${apiOrigin}${path}`, { ...init, headers: { ...init.headers, Authorization: authorization } });

  async function findRef(key: string): Promise<string | null> {
    const { folder, fileName, filePath } = placeOf(key);
    const query = new URLSearchParams({ path: folder, searchQuery: `name = "${fileName}"`, type: "file", limit: "10" });
    const files = (await (await call(api(`/v1/files?${query}`))).json()) as ImageKitFile[];
    return files.find((file) => file.filePath === filePath)?.fileId ?? null;
  }

  const batchDelete = (fileIds: string[]) =>
    call(api("/v1/files/batch/deleteByFileIds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds }) }), [404]);

  async function details(fileId: string): Promise<ImageKitFile | null> {
    const response = await call(api(`/v1/files/${encodeURIComponent(fileId)}/details`), [404]);
    return response.status === 404 ? null : ((await response.json()) as ImageKitFile);
  }

  const asHostFile = (file: ImageKitFile, contentType: string): HostFile => ({
    hostRef: file.fileId,
    bytes: file.size,
    contentType,
    width: file.width ?? null,
    height: file.height ?? null,
  });

  return {
    kind: "imagekit",

    async ticket({ key, contentType, bytes, expiresAt }): Promise<HostTicket> {
      const { folder, fileName } = placeOf(key);
      const fields = {
        fileName,
        folder,
        useUniqueFileName: "false",
        overwriteFile: "false",
        checks: `"file.size" <= ${bytes} AND "file.mime" IN ["${contentType}"]`,
      };
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = await jwt(
        { alg: "HS256", typ: "JWT", kid: config.publicKey },
        { ...fields, iat: issuedAt, exp: Math.floor(expiresAt.getTime() / 1000) },
        config.privateKey,
      );
      return { kind: "form", url: `${uploadOrigin}/api/v2/files/upload`, fields: { ...fields, token }, fileField: "file" };
    },

    async confirm(key, hostRef) {
      const fileId = hostRef ?? (await findRef(key));
      if (fileId === null) return null;
      const file = await details(fileId);
      if (file === null || file.filePath !== placeOf(key).filePath) return null;
      return asHostFile(file, file.mime ?? "application/octet-stream");
    },

    async put({ key, contentType, body }: { key: string; contentType: MediaType; body: Uint8Array }) {
      const { folder, fileName, filePath } = placeOf(key);
      const form = new FormData();
      form.set("file", new Blob([body], { type: contentType }), fileName);
      form.set("fileName", fileName);
      form.set("folder", folder);
      form.set("useUniqueFileName", "false");
      form.set("overwriteFile", "true");
      const response = await call(new Request(`${uploadOrigin}/api/v1/files/upload`, { method: "POST", headers: { Authorization: authorization }, body: form }));
      const file = (await response.json()) as ImageKitFile;
      if (file.filePath !== filePath) throw new MediaError("upload_mismatch", "ImageKit stored the file under another path", { expected: filePath, stored: file.filePath });
      return asHostFile(file, contentType);
    },

    async delete(files) {
      const refs = (await Promise.all(files.map((file) => file.hostRef ?? findRef(file.key)))).filter((ref): ref is string => ref !== null);
      for (let i = 0; i < refs.length; i += DELETE_BATCH) {
        let fileIds = refs.slice(i, i + DELETE_BATCH);
        let response = await batchDelete(fileIds);
        // A batch naming any file already gone deletes none of them: send the rest again.
        while (response.status === 404) {
          const { missingFileIds = [] } = (await response.json()) as { missingFileIds?: string[] };
          if (missingFileIds.length === 0) throw new MediaError("host_refused", "ImageKit answered 404 to a delete without naming the missing files", { fileIds });
          fileIds = fileIds.filter((fileId) => !missingFileIds.includes(fileId));
          if (fileIds.length === 0) break;
          response = await batchDelete(fileIds);
        }
        if (response.status !== 207) continue;
        const { errors = [] } = (await response.json()) as { errors?: Array<{ fileId: string; error: string }> };
        for (const failed of errors) {
          if ((await details(failed.fileId)) !== null) {
            throw new MediaError("host_unavailable", `ImageKit did not delete ${failed.fileId}: ${failed.error}`, { fileId: failed.fileId });
          }
        }
      }
    },
  };
}
