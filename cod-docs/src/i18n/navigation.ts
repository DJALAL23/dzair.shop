import type { NavigationItem } from "zudoku";

export const localeCodes = ["en", "fr", "ar"] as const;
export type LocaleCode = (typeof localeCodes)[number];
export function localeOf(pathname: string): LocaleCode {
  if (pathname === "/fr" || pathname.startsWith("/fr/")) return "fr";
  if (pathname === "/ar" || pathname.startsWith("/ar/")) return "ar";
  return "en";
}

export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(fr|ar)(?=\/|$)/, "") || "/";
}

type Label = { en: string; fr: string; ar: string };
type Page = Label & { slug: string };
type Group = { label: Label; pages: Page[] };

const corePages: Page[] = [
  { slug: "/introduction", en: "Introduction", fr: "Introduction", ar: "مقدمة" },
  { slug: "/getting-started", en: "Getting started", fr: "Démarrage", ar: "البدء" },
  { slug: "/authentication", en: "Authentication", fr: "Authentification", ar: "المصادقة" },
  { slug: "/errors", en: "Errors", fr: "Erreurs", ar: "الأخطاء" },
  { slug: "/webhooks", en: "Webhooks", fr: "Webhooks", ar: "Webhooks" },
  { slug: "/carrier-webhooks", en: "Carrier webhooks", fr: "Webhooks des transporteurs", ar: "Webhooks شركات التوصيل" },
  { slug: "/mcp", en: "MCP server", fr: "Serveur MCP", ar: "خادم MCP" },
];

const coreGroup: Group = {
  label: { en: "Documentation", fr: "Documentation", ar: "التوثيق" },
  pages: corePages,
};

const storefrontGroups: Group[] = [
  {
    label: { en: "Start here", fr: "Commencer ici", ar: "ابدأ من هنا" },
    pages: [
      { slug: "", en: "Overview", fr: "Vue d'ensemble", ar: "نظرة عامة" },
      { slug: "/quickstart", en: "Quick start", fr: "Démarrage rapide", ar: "البدء السريع" },
      { slug: "/how-it-works", en: "How it works", fr: "Fonctionnement", ar: "كيف يعمل" },
      {
        slug: "/agents",
        en: "AI agent kit",
        fr: "Kit pour agents IA",
        ar: "حزمة وكلاء الذكاء الاصطناعي",
      },
    ],
  },
  {
    label: { en: "Data", fr: "Données", ar: "البيانات" },
    pages: [
      {
        slug: "/config",
        en: "Store config and languages",
        fr: "Configuration et langues",
        ar: "إعداد المتجر واللغات",
      },
      {
        slug: "/catalog",
        en: "Products and collections",
        fr: "Produits et collections",
        ar: "المنتجات والمجموعات",
      },
      { slug: "/reviews", en: "Reviews", fr: "Avis", ar: "المراجعات" },
      { slug: "/content", en: "Pages and menus", fr: "Pages et menus", ar: "الصفحات والقوائم" },
    ],
  },
  {
    label: { en: "Cart and checkout", fr: "Panier et commande", ar: "السلة وإتمام الطلب" },
    pages: [
      {
        slug: "/basket",
        en: "Basket and quotes",
        fr: "Panier et devis",
        ar: "السلة وعروض الأسعار",
      },
      {
        slug: "/checkout",
        en: "Checkout and OTP",
        fr: "Commande et OTP",
        ar: "إتمام الطلب وOTP",
      },
      {
        slug: "/delivery",
        en: "Delivery and geography",
        fr: "Livraison et géographie",
        ar: "التوصيل والجغرافيا",
      },
    ],
  },
  {
    label: { en: "Integrate and ship", fr: "Intégrer et livrer", ar: "الدمج والإطلاق" },
    pages: [
      {
        slug: "/presentation",
        en: "Display and Meta events",
        fr: "Affichage et événements Meta",
        ar: "العرض وأحداث Meta",
      },
      {
        slug: "/astro",
        en: "Astro actions and routes",
        fr: "Actions et routes Astro",
        ar: "إجراءات ومسارات Astro",
      },
      {
        slug: "/preview",
        en: "Preview and revalidation",
        fr: "Aperçu et revalidation",
        ar: "المعاينة وإعادة التحقق",
      },
      {
        slug: "/testing",
        en: "Testing a storefront",
        fr: "Tester une vitrine",
        ar: "اختبار واجهة المتجر",
      },
      {
        slug: "/api",
        en: "Public API surface",
        fr: "Surface d'API publique",
        ar: "واجهة API العامة",
      },
    ],
  },
];

const themeGroups: Group[] = [
  {
    label: { en: "Start here", fr: "Commencer ici", ar: "ابدأ من هنا" },
    pages: [
      { slug: "", en: "Overview", fr: "Vue d'ensemble", ar: "نظرة عامة" },
      { slug: "/build", en: "Quick start", fr: "Démarrage rapide", ar: "البدء السريع" },
      {
        slug: "/tutorial",
        en: "Build a complete theme",
        fr: "Construire un thème complet",
        ar: "ابنِ قالبًا كاملًا",
      },
      { slug: "/customize", en: "Customize a theme", fr: "Personnaliser un thème", ar: "تخصيص قالب" },
      {
        slug: "/agents",
        en: "AI agent kit",
        fr: "Kit pour agents IA",
        ar: "حزمة وكلاء الذكاء الاصطناعي",
      },
      { slug: "/tools", en: "Tools and roadmap", fr: "Outils et feuille de route", ar: "الأدوات وخارطة الطريق" },
    ],
  },
  {
    label: { en: "How a theme works", fr: "Fonctionnement d'un thème", ar: "كيف يعمل القالب" },
    pages: [
      { slug: "/fields", en: "Fields", fr: "Champs", ar: "الحقول" },
      { slug: "/composition", en: "Composition", fr: "Composition", ar: "التركيب" },
      { slug: "/pages", en: "Pages and rendering", fr: "Pages et rendu", ar: "الصفحات والعرض" },
    ],
  },
  {
    label: { en: "Appearance and text", fr: "Apparence et textes", ar: "المظهر والنصوص" },
    pages: [
      { slug: "/style", en: "Style and color", fr: "Style et couleur", ar: "النمط واللون" },
      {
        slug: "/settings-copy",
        en: "Settings and copy",
        fr: "Paramètres et textes",
        ar: "الإعدادات والنصوص",
      },
    ],
  },
  {
    label: {
      en: "Preview, publish and test",
      fr: "Aperçu, publication et test",
      ar: "المعاينة والنشر والاختبار",
    },
    pages: [
      { slug: "/manifest", en: "The manifest", fr: "Le manifeste", ar: "البيان" },
      { slug: "/preview", en: "Preview", fr: "Aperçu", ar: "المعاينة" },
      { slug: "/images", en: "Images", fr: "Images", ar: "الصور" },
      { slug: "/testing", en: "Testing a theme", fr: "Tester un thème", ar: "اختبار قالب" },
      {
        slug: "/production",
        en: "Production and upgrades",
        fr: "Production et mises à niveau",
        ar: "الإنتاج والترقية",
      },
    ],
  },
  {
    label: {
      en: "Reference and API",
      fr: "Référence et API",
      ar: "المرجع وAPI",
    },
    pages: [
      {
        slug: "/api",
        en: "Public API surface",
        fr: "Surface d'API publique",
        ar: "واجهة API العامة",
      },
      {
        slug: "/reference-implementation",
        en: "Reference implementation (Theme-00)",
        fr: "Implémentation de référence (Theme-00)",
        ar: "التنفيذ المرجعي (Theme-00)",
      },
      {
        slug: "/troubleshooting",
        en: "Issues and fixes",
        fr: "Problèmes et solutions",
        ar: "المشكلات والحلول",
      },
    ],
  },
];

const referenceLabel: Label = {
  en: "API reference",
  fr: "Référence API (en anglais)",
  ar: "مرجع API (بالإنجليزية)",
};

const allPages: Array<{ base: string; pages: Page[] }> = [
  { base: "", pages: corePages },
  { base: "/sdk/storefront", pages: storefrontGroups.flatMap((group) => group.pages) },
  { base: "/sdk/theme", pages: themeGroups.flatMap((group) => group.pages) },
];

const translatedSlugs = new Set<string>(["/"]);

for (const section of allPages) {
  for (const page of section.pages) {
    translatedSlugs.add(`${section.base}${page.slug}` || "/");
  }
}

function pathFor(locale: LocaleCode, base: string, slug: string): string {
  return locale === "en" ? `${base}${slug}` || "/" : `/${locale}${base}${slug}`;
}

function fileFor(locale: LocaleCode, base: string, slug: string): string {
  const clean = `${base}${slug}`.replace(/^\//, "");
  return locale === "en" ? clean : `${locale}/${clean}`;
}

function navForGroups(
  locale: LocaleCode,
  base: string,
  groups: Group[],
  reference?: string,
): NavigationItem[] {
  const items = groups.flatMap((group) => {
    const pages = group.pages.map(
      (page): NavigationItem => ({
        type: "doc",
        file: fileFor(locale, base, page.slug),
        path: pathFor(locale, base, page.slug),
        label: page[locale],
      }),
    );

    return pages.length > 0
      ? [
          {
            type: "category",
            label: group.label[locale],
            items: pages,
          } as NavigationItem,
        ]
      : [];
  });

  if (reference) {
    items.push({ type: "link", label: referenceLabel[locale], to: reference });
  }

  return items;
}

export function localizedNavigation(pathname: string): NavigationItem[] {
  const locale = localeOf(pathname);
  const path = stripLocale(pathname).replace(/\/$/, "") || "/";

  if (path === "/" || !translatedSlugs.has(path)) return [];

  if (corePages.some((page) => page.slug === path)) {
    return navForGroups(locale, "", [coreGroup], "/api");
  }

  if (path === "/sdk/storefront" || path.startsWith("/sdk/storefront/")) {
    return navForGroups(locale, "/sdk/storefront", storefrontGroups, "/sdk/storefront/reference/README");
  }

  if (path === "/sdk/theme" || path.startsWith("/sdk/theme/")) {
    return navForGroups(locale, "/sdk/theme", themeGroups, "/sdk/theme/reference/README");
  }

  return [];
}

export function isTranslated(pathname: string): boolean {
  const path = stripLocale(pathname).replace(/\/$/, "") || "/";
  return translatedSlugs.has(path);
}

export function localizeHref(href: string, locale: LocaleCode): string | undefined {
  if (locale === "en") return undefined;
  if (!href.startsWith("/") || href.startsWith("//")) return undefined;

  const url = new URL(href, "http://localhost");
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return undefined;
  if (path !== "/" && !translatedSlugs.has(path)) return undefined;

  return `/${locale}${path === "/" ? "" : path}${url.search}${url.hash}`;
}
