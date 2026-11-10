import type { Locale } from "@/i18n/config";
import { commune, wilaya } from "../../../cod-shared/places";

/** A place in the reader's language: Arabic on an Arabic screen, the Latin name otherwise. */
export const placeLabel = (place: { name: string; nameAr: string }, locale: Locale) => (locale === "ar" ? place.nameAr : place.name);

/** A wilaya by its number, in the reader's language; what was stored when the number is not a wilaya. */
export function wilayaLabel(id: number | null | undefined, stored: string | null, locale: Locale): string | null {
  const found = id ? wilaya(id) : undefined;
  return found ? placeLabel(found, locale) : stored;
}

export function communeLabel(id: string | null | undefined, stored: string | null, locale: Locale): string | null {
  const found = id ? commune(id) : undefined;
  return found ? placeLabel(found, locale) : stored;
}
