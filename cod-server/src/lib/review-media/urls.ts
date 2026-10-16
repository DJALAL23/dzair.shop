import type { Env } from "@/types/env";

/**
 * Where review media is served: the media domain (R2, cached at the edge) in
 * production; this server's /images route anywhere else, since local files
 * exist only in the local bucket.
 */
export function reviewMediaUrl(env: Pick<Env, "ENVIRONMENT" | "MEDIA_DOMAIN">, requestUrl: string): (key: string) => string {
  if (env.ENVIRONMENT === "production" && env.MEDIA_DOMAIN) return (key) => `https://${env.MEDIA_DOMAIN}/${key}`;
  const origin = new URL(requestUrl).origin;
  return (key) => `${origin}/images/${key}`;
}
