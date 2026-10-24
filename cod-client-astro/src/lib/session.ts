// Client-side identity + session-JWT source. The ONLY module that talks to
// /api/auth/* for session state (api.ts consumes the token from here).
import type { Identity } from "./gate";

// Same-origin by definition: the Astro worker hosts /api/auth/* itself and
// owns the session cookie. Never target another domain here — cross-origin
// calls drop cookies and die on CORS (the "stuck Checking session" bug).
let cachedJwt: string | null = null;
let inflight: Promise<Identity | null> | null = null;

/** The session could not be checked — rate limited, a server error or no connection. Not the same as signed out. */
export class SessionUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "The session check could not reach the server" : `The session check failed (${status})`);
    this.name = "SessionUnavailableError";
  }
}

const RETRY_DELAYS_MS = [500, 1500, 4000];
const MAX_RETRY_WAIT_MS = 10_000;

function retryWait(res: Response | null, attempt: number) {
  const seconds = Number(res?.headers.get("x-retry-after") ?? res?.headers.get("retry-after"));
  return seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : RETRY_DELAYS_MS[attempt];
}

/** The session response, after waiting out rate limits, server errors and dropped connections. */
async function requestSession(): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/auth/get-session", { credentials: "include" }).catch(() => null);
    if (res && res.status !== 429 && res.status < 500) return res;
    if (attempt >= RETRY_DELAYS_MS.length) throw new SessionUnavailableError(res?.status ?? null);
    await new Promise((resolve) => setTimeout(resolve, retryWait(res, attempt)));
  }
}

/**
 * Fetch the current identity once per page. Resolves:
 *   undefined → check still in flight (never returned by callers directly)
 *   null      → no valid session
 *   Identity  → { user, role, scopes }
 * Rejects with SessionUnavailableError when the session could not be checked;
 * the next call checks again.
 * Captures the short-lived JWT (set-auth-jwt) issued alongside the response.
 */
export function fetchIdentity(): Promise<Identity | null> {
  if (inflight) return inflight;
  const check = (async (): Promise<Identity | null> => {
    const res = await requestSession();
    if (!res.ok) return null;
    const jwt = res.headers.get("set-auth-jwt");
    if (jwt) cachedJwt = jwt;
    const body = (await res.json()) as
      | {
          user?: { id: string; name?: string | null; email: string; role?: string; language?: string } | null;
          scopes?: string[];
        }
      | null;
    if (!body?.user) return null;
    return {
      user: {
        id: body.user.id,
        name: body.user.name ?? null,
        email: body.user.email,
        language: body.user.language,
      },
      role: body.user.role === "admin" ? "admin" : "staff",
      scopes: body.scopes ?? [],
    };
  })();
  inflight = check;
  check.catch(() => {
    if (inflight === check) inflight = null;
  });
  return check;
}

/** Current JWT if already fetched; refreshes via fetchIdentity when absent. */
export async function currentJwt(): Promise<string | null> {
  if (cachedJwt) return cachedJwt;
  await fetchIdentity();
  return cachedJwt;
}

/** Force a new session response after an API rejects the cached token. */
export async function refreshJwt(): Promise<string | null> {
  cachedJwt = null;
  inflight = null;
  await fetchIdentity();
  return cachedJwt;
}
