/**
 * Media Delivery: how a browser fetches a store's keys. A key's URL is the
 * origin, a slash and the key; resizing is the storefront SDK's, by kind.
 */
import { MediaError } from "./errors";
import { isMediaKey } from "./keys";
import { MEDIA_DELIVERY_KINDS, type MediaDeliveryKind, type MediaImage } from "./model";

export interface MediaDelivery {
  kind: MediaDeliveryKind;
  /** An absolute URL with no trailing slash, query or fragment, e.g. `https://ik.imagekit.io/wocart/stores/maysa`. */
  origin: string;
}

/**
 * A store's delivery from its configuration, or `not_configured`. The origin
 * is https, except for `direct` delivery, which local development serves
 * over http.
 */
export function mediaDelivery(kind: string | undefined, origin: string | undefined): MediaDelivery {
  if (!(MEDIA_DELIVERY_KINDS as readonly unknown[]).includes(kind)) {
    throw new MediaError("not_configured", `MEDIA_DELIVERY must be one of ${MEDIA_DELIVERY_KINDS.join(", ")}`, { value: kind ?? null });
  }
  let url: URL;
  try {
    url = new URL(origin ?? "");
  } catch {
    throw new MediaError("not_configured", "MEDIA_ORIGIN must be an absolute URL", { value: origin ?? null });
  }
  const httpAllowed = kind === "direct";
  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    throw new MediaError("not_configured", httpAllowed ? "MEDIA_ORIGIN must be http or https" : "MEDIA_ORIGIN must be https", { value: origin });
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new MediaError("not_configured", "MEDIA_ORIGIN must have no query, fragment or credentials", { value: origin });
  }
  return { kind: kind as MediaDeliveryKind, origin: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

/** The URL of a stored key. A value that is not a Media Key is refused (`key_invalid`). */
export function mediaUrl(key: string, delivery: MediaDelivery): string {
  if (!isMediaKey(key)) throw new MediaError("key_invalid", "Not a Media Key", { key });
  return `${delivery.origin}/${key}`;
}

/** The key a URL of this delivery shows, or null when the URL is not one of its keys. */
export function mediaKeyOf(url: string, delivery: MediaDelivery): string | null {
  const prefix = `${delivery.origin}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length).split(/[?#]/, 1)[0]!;
  return isMediaKey(key) ? key : null;
}

/** A stored image as the API returns it. */
export function mediaImage(stored: { key: string; width: number | null; height: number | null }, delivery: MediaDelivery): MediaImage {
  return { key: stored.key, url: mediaUrl(stored.key, delivery), width: stored.width, height: stored.height };
}
