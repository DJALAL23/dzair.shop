/**
 * What a label and a driver's delivery sheet print: the parcel as the order
 * and its shipment hold it, the store as its sender, and the label's own
 * words in the store's chosen language. Pure — the server reads the rows,
 * the dashboard draws them.
 */

import type { LabelLanguage, ShippingLabelConfig } from "./config";

export interface LabelSender {
  name: string;
  logoUrl: string | null;
  /** The settings' sender phone, else the legal profile's contact phone. */
  phone: string | null;
  address: string | null;
}

export interface LabelPlace {
  name: string;
  nameAr: string;
}

export interface LabelParcel {
  shipmentId: string;
  orderNumber: string;
  /** When the order was given to the driver. */
  handedAt: string;
  /** The cash to collect, frozen on the shipment at handoff. */
  amount: number;
  recipient: {
    name: string;
    phone: string;
    wilaya: LabelPlace | null;
    commune: LabelPlace | null;
    address: string | null;
  };
  items: Array<{ name: string; variant: string | null; quantity: number }>;
  notes: string | null;
  driver: { name: string; phone: string | null } | null;
}

export interface LabelBatch {
  config: ShippingLabelConfig;
  sender: LabelSender;
  /** The store's currency symbol, e.g. "DA". */
  currency: string;
  parcels: LabelParcel[];
}

/** The label's own words. The order's details print as they were written. */
export const LABEL_WORDS = {
  fr: {
    from: "Expéditeur",
    to: "Destinataire",
    amount: "Montant à encaisser",
    order: "Commande",
    date: "Date",
    driver: "Livreur",
    items: "Contenu",
    notes: "Remarque",
    phone: "Tél.",
    homeDelivery: "Livraison à domicile",
    openAllowed: "Ouverture du colis autorisée",
    openForbidden: "Ouverture du colis interdite",
    sheetTitle: "Bordereau de livraison",
    parcels: "Colis",
    customer: "Client",
    address: "Adresse",
    total: "Total à encaisser",
    collected: "Encaissé",
    signDriver: "Signature du livreur",
    signStore: "Signature du magasin",
  },
  ar: {
    from: "المرسل",
    to: "المرسل إليه",
    amount: "المبلغ المطلوب تحصيله",
    order: "الطلب",
    date: "التاريخ",
    driver: "السائق",
    items: "المحتوى",
    notes: "ملاحظة",
    phone: "الهاتف",
    homeDelivery: "توصيل إلى المنزل",
    openAllowed: "يُسمح بفتح الطرد",
    openForbidden: "يُمنع فتح الطرد",
    sheetTitle: "كشف التوصيل",
    parcels: "الطرود",
    customer: "الزبون",
    address: "العنوان",
    total: "المجموع المطلوب تحصيله",
    collected: "المحصَّل",
    signDriver: "إمضاء السائق",
    signStore: "إمضاء المتجر",
  },
} as const satisfies Record<LabelLanguage, Record<string, string>>;

export type LabelWords = (typeof LABEL_WORDS)[LabelLanguage];

/** "+ 2 autres articles" / "+ منتجان آخران": the items a label had no room for. */
export function moreItems(count: number, language: LabelLanguage): string {
  if (language === "fr") return count === 1 ? "+ 1 autre article" : `+ ${count} autres articles`;
  if (count === 1) return "+ منتج آخر";
  if (count === 2) return "+ منتجان آخران";
  return count <= 10 ? `+ ${count} منتجات أخرى` : `+ ${count} منتجًا آخر`;
}

/** At most this many lines on a 100×150 label; the rest are counted. */
export const LABEL_MAX_ITEMS = 5;

/**
 * An amount as a driver reads it on any label: Latin digits, grouped by
 * thousands with a space, then the currency — "3 700 DA" in either language.
 */
export function formatLabelAmount(amount: number, currency: string): string {
  const whole = Math.round(amount);
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${whole < 0 ? "-" : ""}${grouped} ${currency}`;
}

/** "0551234567" as "0551 23 45 67"; any other form as written. */
export function formatLabelPhone(phone: string): string {
  const digits = phone.replace(/\s/g, "");
  return /^0\d{9}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}` : phone.trim();
}

/** A wilaya or commune in the label's language. */
export const placeName = (place: LabelPlace | null, language: LabelLanguage) => (place ? (language === "ar" ? place.nameAr : place.name) : null);
