/**
 * ImageKit as its API reference describes it and a live account answers,
 * for tests: upload V2 checks the JWT's signature, `kid`, expiry and single
 * use, refuses fields that differ from the token's payload, and runs
 * `checks`; the server API takes the private key as Basic auth; an
 * overwrite keeps the file's id; an upload signed for a public key the
 * account does not have is never answered; a batch delete naming any file already gone
 * answers 404 and deletes none. With `listLag`, the file list (search by
 * name) shows a change only after that many more list calls, as a live
 * account's does for a few seconds. `urlEndpoint` serves stored files as an
 * account's URL endpoint does. Requests can be made to fail.
 */
import { sniffMedia } from "../../keys";

interface StoredFile {
  fileId: string;
  name: string;
  folder: string;
  filePath: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface FakeImageKit {
  fetch: (request: Request) => Promise<Response>;
  uploadOrigin: string;
  apiOrigin: string;
  /** Where the account serves its files: this, then a file's path. */
  urlEndpoint: string;
  /** Every stored file, by path. */
  files: Map<string, StoredFile>;
  /** Answer the next `times` requests with `status`. */
  failNext(times: number, status: number): void;
  /** How many requests reached each route. */
  calls: Map<string, number>;
}

const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = (status: number, message: string) => json({ message }, status);

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function verifyJwt(token: string, privateKey: string): Promise<{ header: Record<string, unknown>; payload: Record<string, unknown> } | null> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(privateKey), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64url(signature) as BufferSource, encoder.encode(`${header}.${payload}`));
  if (!valid) return null;
  return { header: JSON.parse(new TextDecoder().decode(fromBase64url(header))), payload: JSON.parse(new TextDecoder().decode(fromBase64url(payload))) };
}

/** `"file.size" <= N AND "file.mime" IN ["a","b"]`, the checks the adapter sends. */
function passesChecks(checks: string, file: { size: number; mime: string }): boolean {
  for (const clause of checks.split(" AND ")) {
    const size = /^"file\.size" <= (\d+)$/.exec(clause);
    if (size) {
      if (file.size > Number(size[1])) return false;
      continue;
    }
    const mime = /^"file\.mime" IN \[(.*)\]$/.exec(clause);
    if (mime) {
      if (!(JSON.parse(`[${mime[1]}]`) as string[]).includes(file.mime)) return false;
      continue;
    }
    throw new Error(`fake ImageKit cannot read the check ${clause}`);
  }
  return true;
}

export function fakeImageKit(keys: { publicKey: string; privateKey: string }, options: { listLag?: number } = {}): FakeImageKit {
  const uploadOrigin = "https://upload.imagekit.test";
  const apiOrigin = "https://api.imagekit.test";
  const urlEndpoint = "https://ik.imagekit.test/fake_id";
  const files = new Map<string, StoredFile>();
  const changes: Array<{ at: number; filePath: string; file: StoredFile | null }> = [];
  let listCalls = 0;
  const changed = (filePath: string, file: StoredFile | null) => changes.push({ at: listCalls, filePath, file });
  const usedTokens = new Set<string>();
  const calls = new Map<string, number>();
  let failures: { times: number; status: number } = { times: 0, status: 0 };
  const basic = `Basic ${btoa(`${keys.privateKey}:`)}`;

  async function store(form: FormData, overwrite: boolean): Promise<Response> {
    const file = form.get("file");
    if (!(file instanceof Blob)) return refuse(400, "Your request is missing file parameter.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMedia(bytes.subarray(0, 16))?.contentType ?? "application/octet-stream";
    const checks = form.get("checks");
    if (typeof checks === "string" && !passesChecks(checks, { size: bytes.byteLength, mime })) return refuse(400, "Your request failed 'checks' validation.");
    const folder = `/${String(form.get("folder") ?? "/").split("/").filter(Boolean).join("/")}`.replace(/^\/$/, "");
    const name = String(form.get("fileName"));
    const filePath = `${folder}/${name}`;
    if (form.get("useUniqueFileName") !== "false") return refuse(400, "fake ImageKit only stores files under their own names");
    if (files.has(filePath) && !overwrite) {
      return refuse(400, "A file with the same name already exists at the exact location. We could not overwrite it because both overwriteFile and useUniqueFileName are set to false.");
    }
    const image = mime.startsWith("image/");
    const stored: StoredFile = {
      fileId: files.get(filePath)?.fileId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 24),
      name,
      folder,
      filePath,
      size: bytes.byteLength,
      mime,
      width: image ? 640 : null,
      height: image ? 480 : null,
      bytes,
    };
    files.set(filePath, stored);
    changed(filePath, stored);
    return json({ fileId: stored.fileId, name, filePath, size: stored.size, width: stored.width, height: stored.height, fileType: image ? "image" : "non-image" });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.url.startsWith(`${urlEndpoint}/`)) {
      calls.set("GET delivery", (calls.get("GET delivery") ?? 0) + 1);
      const file = files.get(request.url.slice(urlEndpoint.length).split("?")[0]!);
      return file ? new Response(file.bytes, { headers: { "Content-Type": file.mime } }) : refuse(404, "Not found");
    }
    const route = `${request.method} ${url.origin === uploadOrigin ? "upload" : "api"}${url.pathname.replace(/\/v1\/files\/[^/]+\/details$/, "/v1/files/:id/details")}`;
    calls.set(route, (calls.get(route) ?? 0) + 1);
    if (failures.times > 0) {
      failures.times -= 1;
      return refuse(failures.status, "fake ImageKit was told to fail");
    }

    if (route === "POST upload/api/v2/files/upload") {
      const form = await request.formData();
      const token = form.get("token");
      if (typeof token !== "string") return refuse(400, "Your request is missing token parameter.");
      if (request.headers.has("Authorization")) return refuse(400, "Your request contains both token and basic auth parameter. Use only one method, you might be exposing your private API key.");
      if (usedTokens.has(token)) return refuse(400, "Your request has invalid token.");
      const verified = await verifyJwt(token, keys.privateKey);
      if (verified !== null && verified.header.kid !== keys.publicKey) {
        return new Promise<Response>((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason)));
      }
      if (verified === null || verified.header.alg !== "HS256") return refuse(400, "Your request has invalid token.");
      usedTokens.add(token);
      const { iat, exp, ...signed } = verified.payload;
      if (typeof exp !== "number" || exp * 1000 < Date.now() || typeof iat !== "number") return refuse(400, "Your request contains expired token.");
      const sent = Object.fromEntries([...form.entries()].filter(([name]) => name !== "file" && name !== "token"));
      const same = Object.keys(signed).length === Object.keys(sent).length && Object.entries(signed).every(([name, value]) => sent[name] === value);
      if (!same) return refuse(400, "Your request contains invalid payload. It does not match with the payload used to generate token.");
      return store(form, form.get("overwriteFile") !== "false");
    }

    if (request.headers.get("Authorization") !== basic) return refuse(401, "Your account cannot be authenticated.");

    if (route === "POST upload/api/v1/files/upload") {
      const form = await request.formData();
      return store(form, form.get("overwriteFile") !== "false");
    }
    if (route === "GET api/v1/files/:id/details") {
      const fileId = decodeURIComponent(url.pathname.split("/")[3]!);
      const file = [...files.values()].find((stored) => stored.fileId === fileId);
      return file ? json({ type: "file", ...file }) : refuse(404, "The requested file does not exist.");
    }
    if (route === "GET api/v1/files") {
      listCalls += 1;
      const listed = new Map<string, StoredFile>();
      for (const change of changes) {
        if (change.at + (options.listLag ?? 0) > listCalls) continue;
        if (change.file) listed.set(change.filePath, change.file);
        else listed.delete(change.filePath);
      }
      const path = url.searchParams.get("path") ?? "/";
      const name = /^name = "(.*)"$/.exec(url.searchParams.get("searchQuery") ?? "")?.[1];
      return json([...listed.values()].filter((file) => file.folder === path.replace(/\/$/, "") && (name === undefined || file.name === name)).map((file) => ({ type: "file", ...file })));
    }
    if (route === "POST api/v1/files/batch/deleteByFileIds") {
      const { fileIds } = (await request.json()) as { fileIds: string[] };
      if (fileIds.length > 100) return refuse(400, "A maximum of 100 files can be deleted at a time.");
      const found = fileIds.map((fileId) => [...files.values()].find((stored) => stored.fileId === fileId));
      const missingFileIds = fileIds.filter((_, i) => found[i] === undefined);
      if (missingFileIds.length) return json({ message: "The requested file(s) does not exist.", missingFileIds }, 404);
      for (const file of found) {
        files.delete(file!.filePath);
        changed(file!.filePath, null);
      }
      return json({ successfullyDeletedFileIds: fileIds });
    }
    return refuse(404, `fake ImageKit has no route ${route}`);
  }

  return {
    fetch: handle,
    uploadOrigin,
    apiOrigin,
    urlEndpoint,
    files,
    calls,
    failNext(times, status) {
      failures = { times, status };
    },
  };
}
