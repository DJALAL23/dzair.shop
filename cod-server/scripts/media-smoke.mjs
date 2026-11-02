#!/usr/bin/env node
/**
 * Media smoke: one image through a running store server and its media host,
 * the way the dashboard and a storefront use them — ticket, upload, complete,
 * the image's URL, a resized URL from @wocart/storefront, then release.
 *
 *   COD_SMOKE_API_KEY=<a staff API key> STORE_API_KEY=<the store API key> \
 *     node scripts/media-smoke.mjs [--server http://localhost:8787]
 *
 * The server defaults to COD_SERVER_URL (process env, then the root .env).
 * Uses `@wocart/storefront` from npm (a dev dependency). Keys are
 * read from the environment only and never printed. Exits non-zero on the
 * first step that fails.
 */
import { deflateSync } from "node:zlib";
import { mediaImageUrl } from "@wocart/storefront";
import { getCloudEnv } from "./cloud-env.mjs";

const at = process.argv.indexOf("--server");
const server = (at > -1 ? process.argv[at + 1] : getCloudEnv().serverUrl).replace(/\/+$/, "");
const staffKey = process.env.COD_SMOKE_API_KEY;
const storeKey = process.env.STORE_API_KEY;
if (!staffKey || !storeKey) {
  console.error("Set COD_SMOKE_API_KEY (a staff API key) and STORE_API_KEY (the store API key).");
  process.exit(2);
}

const WIDTH = 640;
const HEIGHT = 480;

function fail(step, detail) {
  console.error(`✗ ${step}: ${detail}`);
  process.exit(1);
}

function ok(step, detail = "") {
  console.log(`✓ ${step}${detail ? ` — ${detail}` : ""}`);
}

/** A solid PNG, so every step can read its size back without a decoder. */
function png(width, height) {
  const crc = (bytes) => {
    let c = ~0;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG's size from its header, or null for anything else. */
function pngSize(bytes) {
  const buffer = Buffer.from(bytes);
  return buffer.subarray(1, 4).toString() === "PNG" ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } : null;
}

async function api(path, init = {}) {
  const response = await fetch(`${server}${path}`, { ...init, headers: { "X-API-Key": staffKey, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const file = png(WIDTH, HEIGHT);

const ticket = await api("/api/media/uploads", { method: "POST", body: JSON.stringify({ folder: "products", contentType: "image/png", bytes: file.length }) });
if (ticket.status !== 201) fail("ticket", `${ticket.status} ${JSON.stringify(ticket.body)}`);
const { mediaId, key, send } = ticket.body.data;
ok("ticket", `${send.kind} upload of ${key}`);

let hostRef = null;
if (send.kind === "form") {
  const form = new FormData();
  for (const [name, value] of Object.entries(send.fields)) form.append(name, value);
  form.append(send.fileField, new Blob([file], { type: "image/png" }), send.fields.fileName ?? "smoke.png");
  const response = await fetch(send.url, { method: send.method, body: form });
  if (!response.ok) fail("upload", `${response.status} ${await response.text()}`);
  hostRef = (await response.json()).fileId ?? null;
} else if (send.kind === "put") {
  const response = await fetch(send.url, { method: send.method, headers: send.headers, body: file });
  if (!response.ok) fail("upload", `${response.status} ${await response.text()}`);
} else {
  const relayed = await api(send.url, { method: send.method, headers: send.headers, body: file });
  if (relayed.status !== 204) fail("upload", `${relayed.status} ${JSON.stringify(relayed.body)}`);
}
ok("upload", hostRef ? "the host answered its file id" : "sent");

const completed = await api(`/api/media/uploads/${encodeURIComponent(mediaId)}/complete`, { method: "POST", body: JSON.stringify({ hostRef, width: WIDTH, height: HEIGHT }) });
if (completed.status !== 200) fail("complete", `${completed.status} ${JSON.stringify(completed.body)}`);
const image = completed.body.data;
if (image.key !== key || image.width !== WIDTH || image.height !== HEIGHT) fail("complete", JSON.stringify(image));
ok("complete", image.url);

const original = await fetch(image.url);
const originalBytes = new Uint8Array(await original.arrayBuffer());
if (!original.ok || !original.headers.get("content-type")?.startsWith("image/") || originalBytes.length === 0) fail("original", `${original.status} ${original.headers.get("content-type")}`);
ok("original", `${original.status} ${original.headers.get("content-type")}, ${originalBytes.length} bytes`);

const config = await fetch(`${server}/store/config`, { headers: { "X-Store-API-Key": storeKey } });
const delivery = config.ok ? (await config.json()).data?.media : null;
if (!delivery) fail("delivery", `/store/config answered ${config.status} without media`);
ok("delivery", `${delivery.kind} at ${delivery.origin}`);

const resized = mediaImageUrl(image.url, { width: 160, height: 120, fit: "cover", format: "png" }, delivery);
if (resized === null) {
  ok("resize", `skipped: a ${delivery.kind} delivery serves files as stored`);
} else {
  const response = await fetch(resized);
  const size = response.ok ? pngSize(new Uint8Array(await response.arrayBuffer())) : null;
  if (!size || size.width !== 160 || size.height !== 120) fail("resize", `${response.status} ${resized} → ${JSON.stringify(size)}`);
  ok("resize", `${resized} → 160×120`);
}

const group = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `media-smoke ${Date.now()}`, imageKey: key }) });
if (group.status !== 201) fail("attach", `${group.status} ${JSON.stringify(group.body)}`);
const removed = await api(`/api/product-groups/${encodeURIComponent(group.body.data.id)}`, { method: "DELETE" });
if (removed.status !== 200) fail("release", `${removed.status} ${JSON.stringify(removed.body)}`);
const again = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `media-smoke ${Date.now()}`, imageKey: key }) });
if (again.status < 400) fail("release", `the released key could still be attached (${again.status})`);
ok("release", `the file is gone: attaching its key again answers ${again.status} ${again.body?.code}`);
