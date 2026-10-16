/**
 * An upload grant: what lets a shopper send review photos and a voice note
 * without an account. The server issues it once the order number and phone
 * prove the purchase; it names the order, how many files of each kind the
 * store allows, and when it ends, signed with REVIEW_UPLOAD_SECRET. A grant
 * proves nothing else — submitting the review checks the purchase again.
 */
import { newMediaId } from "../../../../cod-shared/reviews/media";

export interface UploadGrant {
  /** Names the grant's upload folder. */
  id: string;
  orderId: string;
  maxPhotos: number;
  /** null = no voice note. */
  voiceMaxSeconds: number | null;
  /** Unix seconds. */
  expiresAt: number;
}

export const GRANT_LIFETIME_SECONDS = 30 * 60;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueUploadGrant(
  secret: string,
  claims: Omit<UploadGrant, "id" | "expiresAt">,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; grant: UploadGrant }> {
  const grant: UploadGrant = { id: newMediaId(), ...claims, expiresAt: nowSeconds + GRANT_LIFETIME_SECONDS };
  const payload = base64url(encoder.encode(JSON.stringify(grant)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload)));
  return { token: `${payload}.${base64url(signature)}`, grant };
}

/** The grant a token carries, or null when it is forged, altered, malformed or past its end. */
export async function readUploadGrant(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<UploadGrant | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || token.length > 2048) return null;
  const signatureBytes = fromBase64url(signature);
  const payloadBytes = fromBase64url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  if (!(await crypto.subtle.verify("HMAC", await key(secret), signatureBytes, encoder.encode(payload)))) return null;
  let grant: UploadGrant;
  try {
    grant = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof grant?.id !== "string" || !/^[a-f0-9]{32}$/.test(grant.id) || typeof grant.orderId !== "string") return null;
  if (typeof grant.expiresAt !== "number" || grant.expiresAt <= nowSeconds) return null;
  return grant;
}
