import { z } from "zod";

const EMAIL = z.string().max(254).email("Invalid email address");

const normalise = (value: string) => value.trim().toLowerCase();

/**
 * An email as every way in takes it: trimmed and lower-cased, so one
 * person's email is one string in the column whichever form typed it. On a
 * create, an empty value means none.
 */
export function newEmailField() {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v ?? undefined;
    return normalise(v) || undefined;
  }, EMAIL.optional());
}

/** The same email on an edit: empty or null clears the stored one; absent leaves it. */
export function editedEmailField() {
  return z.preprocess((v) => {
    if (v === null) return null;
    if (typeof v !== "string") return v ?? undefined;
    return normalise(v) || null;
  }, EMAIL.nullable().optional());
}
