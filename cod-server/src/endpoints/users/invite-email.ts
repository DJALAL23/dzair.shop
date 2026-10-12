/**
 * Team invite email — best-effort send behind the user-creation endpoint.
 *
 * Contract (plan D4):
 *   - Renders the shared invite template (cod-shared/lib/email-templates)
 *     in the invitee's language and hands it to the ONE shared send path
 *     (sendTransactionalEmail): never throws, stable error codes, silent
 *     skip when the store's email config is absent or disabled.
 *   - `invite-{userId}` idempotency key: a retried create can never
 *     double-send.
 *   - The API key is never emailed — only the temporary password travels.
 */

import type { AppDb } from "@/db";
import { getStore } from "../../../../cod-shared/queries/stores";
import { renderInviteEmail } from "../../../../cod-shared/lib/email-templates";
import { sendTransactionalEmail, type TransactionalEmailOutcome } from "../../../../cod-shared/lib/transactional-email";

export type InviteEmailOutcome = TransactionalEmailOutcome;

// In-memory cache for store name (rarely changes, safe to cache)
let storeNameCache: { name: string; ttl: number } | null = null;
const STORE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clear the store name cache. Exported for tests only.
 * @internal
 */
export function clearStoreNameCache() {
  storeNameCache = null;
}

/**
 * Get store name with in-memory caching to avoid repeated D1 queries.
 * The store name rarely changes, so a 5-minute TTL is safe.
 */
async function getStoreName(db: AppDb): Promise<string> {
  if (storeNameCache && Date.now() < storeNameCache.ttl) {
    return storeNameCache.name;
  }
  const store = await getStore(db);
  const name = store?.name ?? "CodFlow";
  storeNameCache = { name, ttl: Date.now() + STORE_CACHE_TTL_MS };
  return name;
}

export interface InviteEmailInput {
  userId: string;
  name: string;
  email: string;
  tempPassword: string;
  language: "ar" | "en";
}

/**
 * Derive the dashboard sign-in URL from BETTER_AUTH_URL. Its documented
 * shape is "<dashboard origin>/api/auth" (wrangler.toml.example) — strip the
 * suffix and point at the sign-in page. A value without the suffix is used
 * as the origin directly.
 */
export function dashboardSignInUrl(betterAuthUrl: string): string {
  const base = betterAuthUrl.replace(/\/api\/auth\/?$/, "").replace(/\/+$/, "");
  return `${base}/sign-in`;
}

export async function sendInviteEmail(
  db: AppDb,
  env: { BETTER_AUTH_URL: string },
  input: InviteEmailInput
): Promise<InviteEmailOutcome> {
  try {
    const storeName = await getStoreName(db);
    const email = renderInviteEmail({
      storeName,
      inviteeName: input.name,
      signInUrl: dashboardSignInUrl(env.BETTER_AUTH_URL),
      tempPassword: input.tempPassword,
      language: input.language,
    });

    return await sendTransactionalEmail(db, {
      to: input.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `invite-${input.userId}`,
    });
  } catch {
    // Best-effort seam: no failure here may ever propagate to user creation.
    return { sent: false, error: "transient" };
  }
}
