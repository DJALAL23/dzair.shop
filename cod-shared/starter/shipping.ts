/**
 * The shipping profile a store starts with, so a checkout can quote delivery
 * from the first order: one default profile, a rule for every wilaya, priced
 * by zone — Algiers, around Algiers, the north, the high plateaus, the south
 * and the far south. Home delivery and stop-desk pickup are both open, as the
 * default checkout offers both. The prices are a starting point the merchant
 * sets to their carrier's.
 */
import type { StoreLocale } from "../i18n/locales";

export interface ShippingZone {
  key: string;
  wilayas: readonly number[];
  home: number;
  stopDesk: number;
}

export const DEFAULT_SHIPPING_ZONES: readonly ShippingZone[] = [
  { key: "algiers", wilayas: [16], home: 400, stopDesk: 300 },
  { key: "around-algiers", wilayas: [9, 35, 42], home: 500, stopDesk: 350 },
  { key: "north", wilayas: [2, 4, 6, 10, 13, 15, 18, 19, 21, 22, 23, 24, 25, 26, 27, 29, 31, 34, 36, 41, 43, 44, 46, 48], home: 600, stopDesk: 400 },
  { key: "high-plateaus", wilayas: [3, 5, 7, 12, 14, 17, 20, 28, 32, 38, 40, 45, 51], home: 700, stopDesk: 450 },
  { key: "south", wilayas: [8, 30, 39, 47, 49, 52, 55, 57, 58], home: 900, stopDesk: 600 },
  { key: "far-south", wilayas: [1, 11, 33, 37, 50, 53, 54, 56], home: 1200, stopDesk: 900 },
];

export const DEFAULT_SHIPPING_PROFILE: { name: Readonly<Record<StoreLocale, string>>; notes: Readonly<Record<StoreLocale, string>> } = {
  name: { ar: "التوصيل القياسي", fr: "Livraison standard", en: "Standard delivery" },
  notes: {
    ar: "أسعار مقترحة حسب المنطقة — عدّلها حسب أسعار شركة التوصيل.",
    fr: "Tarifs proposés par zone — ajustez-les aux prix de votre transporteur.",
    en: "Suggested prices by zone — set them to your carrier's.",
  },
};

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The statements that give a store its default shipping profile — only when
 * it has no default profile and has never taken an order, with its rules only
 * in the run that created it. A store without any profile delivers free, so
 * one that already sells keeps charging what it charges.
 */
export function defaultShippingSql(store: { id: string; lang: StoreLocale }, now: string): string[] {
  const profileId = `${store.id}:shipping:default`;
  const priceOf = (field: "home" | "stopDesk") =>
    `CASE ${DEFAULT_SHIPPING_ZONES.map((zone) => `WHEN w.id IN (${zone.wilayas.join(", ")}) THEN ${zone[field]}`).join(" ")} ELSE ${DEFAULT_SHIPPING_ZONES.at(-1)![field]} END`;
  return [
    `INSERT OR IGNORE INTO shipping_profiles (id, name, is_default, notes, created_at, updated_at) SELECT ${q(profileId)}, ${q(DEFAULT_SHIPPING_PROFILE.name[store.lang])}, 1, ${q(DEFAULT_SHIPPING_PROFILE.notes[store.lang])}, ${q(now)}, ${q(now)} WHERE NOT EXISTS (SELECT 1 FROM shipping_profiles WHERE is_default = 1) AND NOT EXISTS (SELECT 1 FROM orders)`,
    `INSERT OR IGNORE INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at) SELECT ${q(`${profileId}:`)} || w.id, ${q(profileId)}, w.id, ${priceOf("home")}, ${priceOf("stopDesk")}, 1, 1, ${q(now)} FROM wilayas w WHERE (SELECT created_at FROM shipping_profiles WHERE id = ${q(profileId)}) = ${q(now)}`,
  ];
}
