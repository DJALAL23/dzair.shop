/**
 * Rich text holds a store's images as `media:<key>`, never as URLs, so no
 * stored HTML names a host. The API turns them into URLs on the way out and
 * back into keys on the way in; any other image URL is left as it is.
 */
import { mediaKeyOf, mediaUrl, type MediaDelivery } from "./delivery";
import { isMediaKey } from "./keys";

const STORED = /media:([^\s"'<>,]+)/g;
const URL_CANDIDATE = /https?:\/\/[^\s"'<>,]+/g;

/** HTML as a browser reads it: each `media:<key>` replaced by the key's URL. */
export function toServedHtml(html: string, delivery: MediaDelivery): string {
  return html.replace(STORED, (match, key: string) => (isMediaKey(key) ? mediaUrl(key, delivery) : match));
}

/** HTML as it is stored: each URL of one of the store's keys replaced by `media:<key>`. */
export function toStoredHtml(html: string, delivery: MediaDelivery): string {
  return html.replace(URL_CANDIDATE, (url) => {
    const key = mediaKeyOf(url, delivery);
    return key === null ? url : `media:${key}`;
  });
}
