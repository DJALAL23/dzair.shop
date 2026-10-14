import type { Context } from "hono";

/**
 * The shopper's IP on a storefront request.
 *
 * Store routes are called by the store's own storefront worker — they need the
 * store API key — so the connecting peer (`CF-Connecting-IP` on this hop) is
 * that worker, one address shared by every shopper. The storefront forwards
 * the shopper's own address in `X-Forwarded-For`, and that is the one a
 * per-visitor limit or an order's attribution must use. Without it the peer
 * is the only address there is.
 */
export function storefrontClientIp(c: Context): string | undefined {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("CF-Connecting-IP") ||
    undefined
  );
}
