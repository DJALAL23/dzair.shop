/**
 * Rich text holds a store's images as `media:<key>`, never as URLs, so no
 * stored HTML names a host. The API turns them into URLs on the way out and
 * back into keys on the way in; any other image URL is left as it is.
 */
import { mediaKeyOf, mediaUrl, type MediaDelivery } from "./delivery";
import { sanitizeRichText } from "../lib/rich-text";
import { MEDIA_REF, isMediaKey } from "./keys";

const STORED = new RegExp(`${MEDIA_REF}([^\\s"'<>,]+)`, "g");
const URL_CANDIDATE = /https?:\/\/[^\s"'<>,]+/g;

/** The Media Keys rich text shows. */
export function mediaKeysIn(html: string | null | undefined): string[] {
  if (!html) return [];
  return [...new Set([...html.matchAll(STORED)].map((match) => match[1]!).filter(isMediaKey))];
}

/** HTML as a browser reads it: each `media:<key>` replaced by the key's URL. */
export function toServedHtml(html: string, delivery: MediaDelivery): string {
  return html.replace(STORED, (match, key: string) => (isMediaKey(key) ? mediaUrl(key, delivery) : match));
}

/** HTML as it is stored: each URL of one of the store's keys replaced by `media:<key>`. */
export function toStoredHtml(html: string, delivery: MediaDelivery): string {
  return html.replace(URL_CANDIDATE, (url) => {
    const key = mediaKeyOf(url, delivery);
    return key === null ? url : `${MEDIA_REF}${key}`;
  });
}

/**
 * The one way rich text is written: the store's images turned into keys,
 * then sanitised, which keeps an image only when it is one of the store's
 * by key or an https one. Takes HTML from a browser or HTML already stored
 * alike.
 */
export async function storedRichText(html: string, delivery: MediaDelivery): Promise<string> {
  return (await sanitizeRichText(toStoredHtml(toServedHtml(html, delivery), delivery))).html;
}
