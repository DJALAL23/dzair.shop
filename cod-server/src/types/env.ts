/**
 * Cloudflare Worker environment bindings.
 * Declared in wrangler.toml — keep this in sync.
 */

import type { DrainMessage } from "@/events/drain";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** D1 database binding */
  DB: D1Database;
  /**
   * The store's own R2 bucket: its Staging (`staging/`, private, cleared after
   * a day) always, and its media too when MEDIA_HOST is `r2`.
   */
  MEDIA_BUCKET: R2Bucket;
  /** Where the store's media is kept: `imagekit` or `r2` (ADR 0021). Required. */
  MEDIA_HOST?: string;
  /** How browsers fetch the store's media: `imagekit`, `cloudflare` or `direct`. Required. */
  MEDIA_DELIVERY?: string;
  /** The URL a Media Key is appended to, e.g. `https://ik.imagekit.io/<id>/stores/<store>`. Required. */
  MEDIA_ORIGIN?: string;
  /** ImageKit's public key (MEDIA_HOST `imagekit`). */
  IMAGEKIT_PUBLIC_KEY?: string;
  /** ImageKit's private key (secret; MEDIA_HOST `imagekit`). */
  IMAGEKIT_PRIVATE_KEY?: string;
  /** The store's folder in the ImageKit account, e.g. `/stores/maysa` (MEDIA_HOST `imagekit`). */
  IMAGEKIT_FOLDER?: string;
  /**
   * Cloudflare Images binding: Preparation re-encodes staged photos to WebP
   * (which drops EXIF and GPS). Without it a staged photo is never kept.
   */
  IMAGE_TRANSFORM?: ImagesBinding;
  /** Deployment environment: "development" | "production" */
  ENVIRONMENT: string;
  /** Worker URL for API documentation (e.g., "http://localhost:8787" or "https://api.yourdomain.com") */
  WORKER_URL?: string;
  /** Comma-separated list of allowed CORS origins (e.g., "http://localhost:3000,https://app.example.com") */
  ALLOWED_ORIGINS?: string;
  /**
   * Optional storefront fallback origin (e.g., "https://store.example.com").
   * Landing page share URLs prefer the store's own domain (stores.domain,
   * set by the merchant in Store Settings); this var is the fallback for
   * deployments without a custom domain yet.
   */
  STOREFRONT_URL?: string;

  // ─── MCP remote server (added MCP-8) ───────────────────────────────────────
  /**
   * Origin of the Better Auth OAuth Authorization Server (dashboard URL).
   * Used as the `iss` claim when verifying MCP bearer tokens AND to derive
   * the JWKS URL (`${BETTER_AUTH_URL}/api/auth/jwks`).
   */
  BETTER_AUTH_URL: string;
  /**
   * This Worker's own public origin. Used as the required `aud` claim when
   * verifying MCP bearer tokens — stops a token minted for tenant A from
   * being accepted against tenant B.
   */
  WORKER_SELF_URL: string;
  /**
   * Where Telegram sends the Telegram App's bot updates, when it is not
   * `WORKER_SELF_URL` — a tunnel to a local server, whose own URL Telegram
   * cannot reach. Optional; must be https.
   */
  TELEGRAM_UPDATES_ORIGIN?: string;
  /**
   * HMAC secret (>= 32 bytes) shared with the Astro dashboard for the MCP OAuth
   * login tickets minted after dashboard sign-in. Optional: when missing or too
   * short, the MCP authorize flow fails closed.
   */
  MCP_LOGIN_TICKET_SECRET?: string;
  /** KV namespace for the MCP OAuth provider (clients, grants, tokens, props). */
  OAUTH_KV: KVNamespace;
  /**
   * KV namespace for rate limiting. Optional: the OTP send guards treat an
   * absent binding as "no local guard" (the provider's own limits remain the
   * hard bound) — a KV failure must never block a send.
   */
  RATE_LIMIT?: KVNamespace;
  /** OAuth helpers injected into `env` by the OAuthProvider before handlers run. */
  OAUTH_PROVIDER?: OAuthHelpers;
  /**
   * The events queue (ADR 0017). It carries only "work is due" and wakes the
   * drain (`src/events/drain.ts`), which processes the carriers' webhook inbox
   * and delivers Business Events. Required: every store's deployment
   * provisions it, with this Worker as its consumer.
   */
  EVENTS_QUEUE: Queue<DrainMessage>;
  /**
   * Cloudflare Workflow binding for CodLandingPageImageUploadWorkflow.
   * Durable background upload of MCP-agent images into the landing page stack.
   */
  LP_IMAGE_UPLOAD_WORKFLOW: Workflow;
  /**
   * Prepares a shopper's review photos and voice note after the review is in
   * (CodReviewMediaWorkflow). Without it the storefront takes text reviews only.
   */
  REVIEW_MEDIA_WORKFLOW?: Workflow;
  /**
   * Signs review upload grants (wrangler secret). Without it the storefront
   * takes text reviews only.
   */
  REVIEW_UPLOAD_SECRET?: string;
  /**
   * Cloudflare rate-limit binding: review attempts per order number, so a
   * phone cannot be guessed for one order. Missing in local dev: no limit.
   */
  REVIEW_RATE_LIMITER?: RateLimit;
}
