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
  announcementBar: text("شريط الإعلانات", "Barre d'annonces", "Announcement bar"),
  header: text("رأس الصفحة", "En-tête", "Header"),
  footer: text("تذييل الصفحة", "Pied de page", "Footer"),
  hero: text("البانر الرئيسي", "Bannière principale", "Hero"),
  categoryCards: text("بطاقات الفئات", "Cartes des catégories", "Category cards"),
  bestSellers: text("الأكثر مبيعاً", "Meilleures ventes", "Best sellers"),
  howItWorks: text("كيف يعمل", "Comment ça marche", "How it works"),
  newArrivals: text("وصل حديثاً", "Nouveautés", "New arrivals"),
  featuredProducts: text("منتجات مميزة", "Produits en vedette", "Featured products"),
  onSale: text("تخفيضات", "En promotion", "On sale"),
  featuresBar: text("شريط المزايا", "Barre des avantages", "Features bar"),
  whatsappCta: text("دعوة واتساب", "Appel à l'action WhatsApp", "WhatsApp call to action"),
  customerTestimonials: text("آراء العملاء", "Avis clients", "Customer testimonials"),
  imageBanner: text("بانر بصورة", "Bannière avec image", "Image banner"),
  richText: text("نص منسق", "Texte mis en forme", "Rich text"),
  faq: text("الأسئلة الشائعة", "Questions fréquentes", "FAQ"),
  featuredProduct: text("منتج بارز", "Produit à la une", "Featured product"),
};

export const FIELD = {
  menu: text("القائمة", "Menu", "Menu"),
  link: text("الرابط", "Lien", "Link"),
  logoPosition: text("موضع الشعار", "Position du logo", "Logo position"),
  logoWidth: text("عرض الشعار", "Largeur du logo", "Logo width"),
  sticky: text("يبقى ظاهراً عند التمرير", "Reste visible au défilement", "Stays visible on scroll"),
  autoplay: text("تبديل الرسائل تلقائياً", "Faire défiler les messages", "Rotate messages"),
  about: text("نبذة", "Présentation", "About text"),
  showLanguages: text("إظهار اختيار اللغة", "Afficher le choix de langue", "Show language picker"),
  scheme: text("الألوان", "Couleurs", "Colors"),
  style: text("المسافات والعرض", "Espacement et largeur", "Spacing and width"),
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
  collection: text("المجموعة المعروضة", "Collection affichée", "Collection shown"),
  productsShown: text("عدد المنتجات المعروضة", "Produits affichés", "Products shown"),
  categoriesShown: text("عدد الفئات المعروضة", "Catégories affichées", "Categories shown"),
  showReviews: text("عرض التقييمات", "Afficher les avis", "Show reviews"),
  feature: (n: number) => text(`الميزة ${n}`, `Avantage ${n}`, `Feature ${n}`),
  stepTitle: (n: number) => text(`عنوان الخطوة ${n}`, `Titre de l'étape ${n}`, `Step ${n} title`),
  stepText: (n: number) => text(`نص الخطوة ${n}`, `Texte de l'étape ${n}`, `Step ${n} text`),
  image: text("الصورة", "Image", "Image"),
  imageSide: text("موضع الصورة", "Côté de l'image", "Image side"),
  text: text("النص", "Texte", "Text"),
  alignment: text("المحاذاة", "Alignement", "Alignment"),
  questions: text("الأسئلة", "Questions", "Questions"),
  question: text("السؤال", "Question", "Question"),
  answer: text("الجواب", "Réponse", "Answer"),
  product: text("المنتج", "Produit", "Product"),
};

/** The words an editor shows for a select field's options. */
export const OPTION = {
  sharp: text("حادة", "Nets", "Sharp"),
  soft: text("ناعمة", "Doux", "Soft"),
  round: text("دائرية", "Arrondis", "Round"),
  square: text("مربعة", "Carré", "Square"),
  portrait: text("طولية", "Portrait", "Portrait"),
  landscape: text("عرضية", "Paysage", "Landscape"),
  start: text("في البداية", "Au début", "At the start"),
  end: text("في النهاية", "À la fin", "At the end"),
  center: text("في الوسط", "Au centre", "Centered"),
};

export const GROUP = {
  home: text("الصفحة الرئيسية", "Accueil", "Home"),
  header: text("رأس الصفحة", "En-tête", "Header"),
  footer: text("تذييل الصفحة", "Pied de page", "Footer"),
};

/** The blocks a section arranges, as the editor names them. */
export const BLOCK = {
  announcement: text("إعلان", "Annonce", "Announcement"),
  footerAbout: text("عن المتجر", "À propos", "About the store"),
  footerMenu: text("قائمة روابط", "Menu de liens", "Link menu"),
  footerPages: text("صفحات المتجر", "Pages de la boutique", "Store pages"),
  footerText: text("نص", "Texte", "Text"),
};

/** The parts every page shares. */
export const AREA = {
  header: text("رأس الصفحة", "En-tête", "Header"),
  footer: text("تذييل الصفحة", "Pied de page", "Footer"),
};

export const SURFACE = {
  home: text("الصفحة الرئيسية", "Accueil", "Home"),
};

/** The theme's global settings (`settings.ts`), as the editor groups them. */
export const SETTINGS_GROUP = {
  colors: text("الألوان", "Couleurs", "Colors"),
  typography: text("الخطوط", "Typographie", "Typography"),
  shape: text("الأشكال", "Formes", "Shape"),
  productCards: text("بطاقات المنتجات", "Cartes produit", "Product cards"),
};

export const SETTING = {
  colorSchemes: text("مخططات الألوان", "Palettes de couleurs", "Color schemes"),
  pageScheme: text("ألوان الصفحة", "Couleurs de la page", "Page colors"),
  headingFont: text("خط العناوين", "Police des titres", "Headings font"),
  font: text("خط النصوص", "Police du texte", "Body font"),
  corners: text("الزوايا", "Coins", "Corners"),
  cardImageRatio: text("شكل صورة المنتج", "Format de l'image produit", "Product image shape"),
};

/** The theme's default color schemes, as the editor names them. */
export const SCHEME = {
  light: text("فاتح", "Clair", "Light"),
  stone: text("حجري", "Pierre", "Stone"),
  mist: text("ضبابي", "Brume", "Mist"),
  night: text("ليلي", "Nuit", "Night"),
  saffron: text("زعفراني", "Safran", "Saffron"),
};
