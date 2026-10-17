/**
 * The editor's vocabulary for the home catalog, in every language the theme
 * ships (`theme.ts` declares `locales`). These are labels a merchant reads in
 * the editor, not storefront copy: storefront copy lives in `content/`.
 *
 * One place, so "Title" is translated once and every section shares it. The
 * SDK fails the catalog (`validateThemeDefinition`) when a label misses one of
 * the declared languages.
 */
import type { LocalizedText } from "@wocart/theme";

const text = (ar: string, fr: string, en: string): LocalizedText => ({ ar, fr, en });

export const SECTION = {
  hero: text("البانر الرئيسي", "Bannière principale", "Hero"),
  categoryCards: text("بطاقات الفئات", "Cartes des catégories", "Category cards"),
  bestSellers: text("الأكثر مبيعاً", "Meilleures ventes", "Best sellers"),
  howItWorks: text("كيف يعمل", "Comment ça marche", "How it works"),
  newArrivals: text("وصل حديثاً", "Nouveautés", "New arrivals"),
  featuresBar: text("شريط المزايا", "Barre des avantages", "Features bar"),
  whatsappCta: text("دعوة واتساب", "Appel à l'action WhatsApp", "WhatsApp call to action"),
  customerTestimonials: text("آراء العملاء", "Avis clients", "Customer testimonials"),
};

export const FIELD = {
  eyebrow: text("النص العلوي", "Surtitre", "Eyebrow"),
  title: text("العنوان", "Titre", "Title"),
  subtitle: text("العنوان الفرعي", "Sous-titre", "Subtitle"),
  trustTitle: (n: number) => text(`عنوان الضمان ${n}`, `Titre de la garantie ${n}`, `Promise ${n} title`),
  trustSub: (n: number) => text(`وصف الضمان ${n}`, `Texte de la garantie ${n}`, `Promise ${n} text`),
  button: text("الزر", "Bouton", "Button"),
  buttonLink: text("رابط الزر", "Lien du bouton", "Button link"),
  primaryButton: text("الزر الرئيسي", "Bouton principal", "Primary button"),
  primaryButtonLink: text("رابط الزر الرئيسي", "Lien du bouton principal", "Primary button link"),
  secondaryButton: text("الزر الثانوي", "Bouton secondaire", "Secondary button"),
  secondaryButtonLink: text("رابط الزر الثانوي", "Lien du bouton secondaire", "Secondary button link"),
  productsShown: text("عدد المنتجات المعروضة", "Produits affichés", "Products shown"),
  categoriesShown: text("عدد الفئات المعروضة", "Catégories affichées", "Categories shown"),
  showReviews: text("عرض التقييمات", "Afficher les avis", "Show reviews"),
  feature: (n: number) => text(`الميزة ${n}`, `Avantage ${n}`, `Feature ${n}`),
  stepTitle: (n: number) => text(`عنوان الخطوة ${n}`, `Titre de l'étape ${n}`, `Step ${n} title`),
  stepText: (n: number) => text(`نص الخطوة ${n}`, `Texte de l'étape ${n}`, `Step ${n} text`),
};

export const GROUP = {
  home: text("الصفحة الرئيسية", "Accueil", "Home"),
};

export const SURFACE = {
  home: text("الصفحة الرئيسية", "Accueil", "Home"),
};

/** The theme's global settings (`settings.ts`), as the editor groups them. */
export const SETTINGS_GROUP = {
  typography: text("الخطوط", "Typographie", "Typography"),
  navigation: text("التنقل", "Navigation", "Navigation"),
};

export const SETTING = {
  font: text("خط المتجر", "Police de la boutique", "Store font"),
  headerMenu: text("قائمة رأس الصفحة", "Menu de l'en-tête", "Header menu"),
  footerMenu: text("قائمة التذييل", "Menu du pied de page", "Footer menu"),
};
