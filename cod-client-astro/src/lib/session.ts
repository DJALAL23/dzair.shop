// Client-side identity + session-JWT source. The ONLY module that talks to
// /api/auth/* for session state (api.ts consumes the token from here).
import type { Identity } from "./gate";

// Same-origin by definition: the Astro worker hosts /api/auth/* itself and
// owns the session cookie. Never target another domain here — cross-origin
// calls drop cookies and die on CORS (the "stuck Checking session" bug).
let cachedJwt: string | null = null;
let inflight: Promise<Identity | null> | null = null;
/** The server's last answer this page session: undefined until one arrives. */
let answered: Identity | null | undefined = undefined;
const watchers = new Set<(identity: Identity | null) => void>();

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
  check.then(
    (identity) => {
      if (inflight !== check) return;
      answered = identity;
      watchers.forEach((watch) => watch(identity));
    },
    () => {
      if (inflight === check) inflight = null;
    },
  );
  return check;
}

/**
 * The session as the server last answered it on this page session, without
 * waiting: undefined while no answer has come. A page opened by a click
 * inside the dashboard renders at once from it; the server still checks
 * every API call, and signing out reloads the page, which forgets it.
 */
export function knownIdentity(): Identity | null | undefined {
  return answered;
}

/** Calls the listener with every answer the server gives from now on, until the returned function is called. */
export function watchIdentity(listener: (identity: Identity | null) => void): () => void {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
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
  answered = undefined;
  await fetchIdentity();
  return cachedJwt;
}
