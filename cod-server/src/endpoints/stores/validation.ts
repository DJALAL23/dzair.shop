import { z } from "zod";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import {
  CONTENT_OVERRIDE_LIMITS,
  THEME_KEY_RE,
  isOverrideKey,
} from "../../../../cod-shared/i18n/content-overrides";

const storeLocale = z.enum(STORE_LOCALES);

export const themeKeySchema = z.string().regex(THEME_KEY_RE, "A theme key is lowercase kebab-case, at most 64 characters");

/**
 * The store's whole language list. Each language once; whether the primary is
 * in it and published is checked against the primary the save leaves behind
 * (`planStoreLanguages`), since `lang` may change in the same save.
 */
const storeLanguages = z
  .array(z.object({ locale: storeLocale, published: z.boolean() }))
  .min(1)
  .max(STORE_LOCALES.length)
  .refine((rows) => new Set(rows.map((row) => row.locale)).size === rows.length, {
    message: "Each language may appear once",
  });

/**
 * A JSON Merge Patch (RFC 7396) of one theme's text in one language: a string
 * sets a key, `null` removes it.
 */
export const contentOverridesPatchSchema = z.object({
  theme: themeKeySchema,
  locale: storeLocale,
  values: z
    .record(
      z.string().refine(isOverrideKey, `Keys are 1–${CONTENT_OVERRIDE_LIMITS.keyLength} characters`),
      z.string().max(CONTENT_OVERRIDE_LIMITS.valueLength).nullable(),
    )
    .refine((values) => Object.keys(values).length <= CONTENT_OVERRIDE_LIMITS.keysPerLocale, {
      message: `At most ${CONTENT_OVERRIDE_LIMITS.keysPerLocale} keys per language`,
    }),
});

export const contentOverridesQuerySchema = z.object({ theme: themeKeySchema });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid hex color");

export const updateStoreSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logoUrl: z.string().url().nullable().optional(),
  /**
   * The storefront's custom domain (e.g. "demo.codflow.store"). Merchants
   * connect their own domain and set it here; landing page links and share
   * URLs are built from it. No scheme — https is always assumed. null clears
   * it (links fall back to the deployment's storefront URL or relative paths).
   */
  domain: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i, "Domain must be a valid hostname like example.com or store.example.com")
    .max(200)
    .nullable()
    .optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  bgColor: hexColor.optional(),
  fontFamily: z.string().min(1).max(200).optional(),
  fontUrl: z.string().url().nullable().optional(),
  /** The primary language. Changing it alone also adds and publishes it. */
  lang: storeLocale.optional(),
  /** Replaces the store's languages; must publish the primary. */
  languages: storeLanguages.optional(),
  currencySymbol: z.string().min(1).max(10).optional(),
  metaTitle: z.string().max(200).nullable().optional(),
  metaDescription: z.string().max(500).nullable().optional(),
  ogImage: z.string().url().nullable().optional(),
  announcementBar: z.string().max(500).nullable().optional(),
  reviewsEnabled: z.boolean().optional(),
  /**
   * Shopping cart opt-in. Strictly boolean: a form posting the string "false"
   * is truthy in JS, so the schema is what has to refuse it. Omit the field to
   * leave the setting unchanged; null is not a way to say "off".
   */
  cartEnabled: z.boolean().optional(),
  /**
   * Order subtotal (DZD) at or above which delivery is free.
   * null turns the feature OFF. A minimum of 1 is deliberate: 0 would mean
   * every order ships free, which is a different intention and must be
   * expressed by setting the threshold to 1, not by a value that reads as
   * "unset". Guarding it here keeps the ambiguity out of the database.
   */
  freeShippingThreshold: z
    .number()
    .int()
    .min(1, "Threshold must be at least 1 DZD — use null to turn it off")
    .max(10_000_000)
    .nullable()
    .optional(),
  /** Which rate a basket spanning several shipping profiles pays. */
  cartShippingMode: z.enum(["highest", "default_profile"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
