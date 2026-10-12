import { z } from "zod";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import { CONTENT_OVERRIDE_LIMITS } from "../../../../cod-shared/i18n/content-overrides";

const storeLocale = z.enum(STORE_LOCALES);

/**
 * One language's text overrides: the theme's pack keys to strings, capped so a
 * store row stays small. The same caps the reader enforces
 * (`parseContentOverrides`), so nothing accepted here is dropped on read.
 */
const localeOverrides = z
  .record(
    z.string().min(1).max(CONTENT_OVERRIDE_LIMITS.keyLength).refine((key) => key !== "__proto__"),
    z.string().max(CONTENT_OVERRIDE_LIMITS.valueLength),
  )
  .refine((entries) => Object.keys(entries).length <= CONTENT_OVERRIDE_LIMITS.keysPerLocale, {
    message: `At most ${CONTENT_OVERRIDE_LIMITS.keysPerLocale} overrides per language`,
  });

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
  /** The primary language. Changing it also enables it (it is always served). */
  lang: storeLocale.optional(),
  /**
   * The languages the store serves. The primary language is always served, so
   * a list that leaves it out gets it back rather than failing.
   */
  enabledLocales: z.array(storeLocale).min(1).max(STORE_LOCALES.length).optional(),
  /** Storefront text overrides per language; replaces the whole map. */
  contentOverrides: z.partialRecord(storeLocale, localeOverrides).optional(),
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
