/**
 * How the editor groups this theme's words: one group per area file, in the
 * order a shopper meets them, so a key is found where its file sits. The
 * words for screen readers (`aria…`) are grouped apart, whichever file holds
 * them.
 */
import type { ContentGroup } from "@wocart/theme";
import { arCart } from "./ar/cart";
import { arContact } from "./ar/contact";
import { arCoupon } from "./ar/coupon";
import { arHome } from "./ar/home";
import { arLayout } from "./ar/layout";
import { arListing } from "./ar/listing";
import { arMisc } from "./ar/misc";
import { arOffers } from "./ar/offers";
import { arOrderForm } from "./ar/order-form";
import { arOrderSummary } from "./ar/order-summary";
import { arOtp } from "./ar/otp";
import { arProduct } from "./ar/product";
import { arReviews } from "./ar/reviews";
import { arStates } from "./ar/states";
import { arThankYou } from "./ar/thank-you";
import { arTrackOrder } from "./ar/track-order";
import { arWhatsappWidget } from "./ar/whatsapp-widget";
import { enCart } from "./en/cart";
import { enContact } from "./en/contact";
import { enCoupon } from "./en/coupon";
import { enHome } from "./en/home";
import { enLayout } from "./en/layout";
import { enListing } from "./en/listing";
import { enMisc } from "./en/misc";
import { enOffers } from "./en/offers";
import { enOrderForm } from "./en/order-form";
import { enOrderSummary } from "./en/order-summary";
import { enOtp } from "./en/otp";
import { enProduct } from "./en/product";
import { enReviews } from "./en/reviews";
import { enStates } from "./en/states";
import { enThankYou } from "./en/thank-you";
import { enTrackOrder } from "./en/track-order";
import { enWhatsappWidget } from "./en/whatsapp-widget";
import { frCart } from "./fr/cart";
import { frContact } from "./fr/contact";
import { frCoupon } from "./fr/coupon";
import { frHome } from "./fr/home";
import { frLayout } from "./fr/layout";
import { frListing } from "./fr/listing";
import { frMisc } from "./fr/misc";
import { frOffers } from "./fr/offers";
import { frOrderForm } from "./fr/order-form";
import { frOrderSummary } from "./fr/order-summary";
import { frOtp } from "./fr/otp";
import { frProduct } from "./fr/product";
import { frReviews } from "./fr/reviews";
import { frStates } from "./fr/states";
import { frThankYou } from "./fr/thank-you";
import { frTrackOrder } from "./fr/track-order";
import { frWhatsappWidget } from "./fr/whatsapp-widget";

type Packs = readonly [object, object, object];

const SCREEN_READER = /^aria[A-Z]/;

const keysOf = (packs: Packs): string[] => [...new Set(packs.flatMap((pack) => Object.keys(pack)))];

const AREAS: readonly [key: string, ar: string, fr: string, en: string, packs: Packs][] = [
  ["layout", "رأس الصفحة والتذييل", "En-tête et pied de page", "Header and footer", [arLayout, frLayout, enLayout]],
  ["home", "الصفحة الرئيسية", "Page d’accueil", "Home page", [arHome, frHome, enHome]],
  ["listing", "قوائم المنتجات", "Listes de produits", "Product lists", [arListing, frListing, enListing]],
  ["product", "صفحة المنتج", "Page produit", "Product page", [arProduct, frProduct, enProduct]],
  ["offers", "العروض", "Offres", "Offers", [arOffers, frOffers, enOffers]],
  ["reviews", "التقييمات", "Avis", "Reviews", [arReviews, frReviews, enReviews]],
  ["cart", "السلة", "Panier", "Cart", [arCart, frCart, enCart]],
  ["order-form", "استمارة الطلب", "Formulaire de commande", "Order form", [arOrderForm, frOrderForm, enOrderForm]],
  ["order-summary", "ملخص الطلب", "Récapitulatif de commande", "Order summary", [arOrderSummary, frOrderSummary, enOrderSummary]],
  ["coupon", "أكواد التخفيض", "Codes promo", "Discount codes", [arCoupon, frCoupon, enCoupon]],
  ["otp", "تأكيد رقم الهاتف", "Vérification du téléphone", "Phone verification", [arOtp, frOtp, enOtp]],
  ["thank-you", "صفحة الشكر", "Page de remerciement", "Thank-you page", [arThankYou, frThankYou, enThankYou]],
  ["track-order", "تتبّع الطلب", "Suivi de commande", "Order tracking", [arTrackOrder, frTrackOrder, enTrackOrder]],
  ["contact", "اتصل بنا", "Contact", "Contact", [arContact, frContact, enContact]],
  ["whatsapp", "واتساب", "WhatsApp", "WhatsApp", [arWhatsappWidget, frWhatsappWidget, enWhatsappWidget]],
  ["states", "الصفحات الفارغة وصفحات الخطأ", "Pages vides et d’erreur", "Empty and error pages", [arStates, frStates, enStates]],
  ["general", "عام", "Général", "General", [arMisc, frMisc, enMisc]],
];

const groups: ContentGroup[] = AREAS.map(([key, ar, fr, en, packs]) => ({
  key,
  label: { ar, fr, en },
  prefixes: keysOf(packs).filter((name) => !SCREEN_READER.test(name)),
}));

groups.push({
  key: "screen-readers",
  label: { ar: "قارئات الشاشة", fr: "Lecteurs d’écran", en: "Screen readers" },
  prefixes: AREAS.flatMap(([, , , , packs]) => keysOf(packs)).filter((name) => SCREEN_READER.test(name)),
});

/** The theme's word groups, for `defineTheme({ contentGroups })`. */
export const CONTENT_GROUPS: readonly ContentGroup[] = groups.filter((group) => group.prefixes.length > 0);
