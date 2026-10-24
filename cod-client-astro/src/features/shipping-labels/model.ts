import { encodeCode128 } from "../../../../cod-shared/shipping-label/code128";
import { LABEL_MAX_ITEMS } from "../../../../cod-shared/shipping-label/label";
import type { LabelLanguage } from "../../../../cod-shared/shipping-label/config";
import type { LabelParcel } from "./types";

/** What a labels print page prints: these shipments, or everything still out with a driver. */
export type LabelsToPrint = { shipmentIds: string[] } | { driverId: string };

/** The page that prints these labels in a new tab. */
export function printLabelsHref(what: LabelsToPrint): string {
  const query = "driverId" in what ? `driver=${encodeURIComponent(what.driverId)}` : `shipments=${what.shipmentIds.map(encodeURIComponent).join(",")}`;
  return `/print/labels?${query}`;
}

export function deliverySheetHref(driverId: string): string {
  return `/print/delivery-sheet?driver=${encodeURIComponent(driverId)}`;
}

/** The print page's query, or null when it names nothing to print. */
export function readLabelsQuery(search: string): LabelsToPrint | null {
  const params = new URLSearchParams(search);
  const driverId = params.get("driver")?.trim();
  if (driverId) return { driverId };
  const shipmentIds = [...new Set((params.get("shipments") ?? "").split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  return shipmentIds.length ? { shipmentIds } : null;
}

/** The lines a label has room for, and how many it leaves out. */
export function labelItems(parcel: Pick<LabelParcel, "items">) {
  if (parcel.items.length <= LABEL_MAX_ITEMS) return { shown: parcel.items, more: 0 };
  return { shown: parcel.items.slice(0, LABEL_MAX_ITEMS - 1), more: parcel.items.length - (LABEL_MAX_ITEMS - 1) };
}

/** Ten modules of white on each side, as Code 128 needs to be read. */
export const QUIET_MODULES = 10;

/**
 * The barcode of a text, sized for the label: modules of 0.375 mm — three
 * dots of a 203 dpi thermal head, so every bar prints the same width — or
 * narrower when that would not fit.
 */
export function barcodeGeometry(text: string, maxWidthMm: number) {
  const { widths, modules } = encodeCode128(text);
  const total = modules + QUIET_MODULES * 2;
  const moduleMm = Math.min(0.375, maxWidthMm / total);
  let x = QUIET_MODULES;
  const bars: Array<{ x: number; width: number }> = [];
  widths.forEach((width, i) => {
    if (i % 2 === 0) bars.push({ x, width });
    x += width;
  });
  return { bars, modules: total, moduleMm, widthMm: total * moduleMm };
}

/** A parcel to preview the label with, before any order has been given to a driver. */
export function sampleParcel(language: LabelLanguage): LabelParcel {
  return {
    shipmentId: "sample",
    orderNumber: "ORD-20261024-4730",
    handedAt: new Date().toISOString(),
    amount: 3700,
    recipient: {
      name: language === "ar" ? "أمينة بن علي" : "Amina Benali",
      phone: "0551234567",
      wilaya: { name: "Alger", nameAr: "الجزائر" },
      commune: { name: "Bab Ezzouar", nameAr: "باب الزوار" },
      address: language === "ar" ? "حي 200 مسكن، العمارة 4، الطابق 2" : "Cité 200 Logements, Bt 4, 2e étage",
    },
    items: [
      { name: language === "ar" ? "فستان صيفي" : "Robe d'été", variant: "M / Rouge", quantity: 2 },
      { name: language === "ar" ? "وشاح حريري" : "Foulard en soie", variant: null, quantity: 1 },
    ],
    notes: language === "ar" ? "الاتصال قبل الوصول" : "Appeler avant de venir",
    driver: { name: "Samir Bey", phone: "0770000001" },
  };
}
