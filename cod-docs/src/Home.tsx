import { BrowserWindow, Button, Head, LandingPage, Link } from "zudoku/components";
import {
  ArrowRightIcon,
  BotIcon,
  BracesIcon,
  KeyRoundIcon,
  PackageIcon,
  PaletteIcon,
  TerminalIcon,
} from "zudoku/icons";

type Locale = "en" | "fr" | "ar";

type Card = {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  hint: string;
  cta: string;
};

type Copy = {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  getStarted: string;
  apiReference: string;
  installLabel: string;
  installCommand: string;
  stats: { value: string; label: string }[];
  waysEyebrow: string;
  waysTitle: string;
  waysBody: string;
  cards: Card[];
  quickstart: string;
  quickstartTitle: string;
  quickstartBody: string;
  steps: string[];
  readGuide: string;
  authentication: string;
  keysTitle: string;
  keysNote: string;
  keys: { label: string; detail: string; command: string }[];
  asideUrl: string;
  asideNote: string;
  ctaTitle: string;
  ctaBody: string;
  storefrontSdk: string;
  themeSdk: string;
  pageTitle: string;
  pageDescription: string;
};

const copy: Record<Locale, Copy> = {
  en: {
    eyebrow: "Wocart developer platform",
    title: (
      <>
        Wocart — COD commerce, <span className="text-primary">from API to storefront.</span>
      </>
    ),
    description:
      "Wocart is the platform behind cash-on-delivery storefronts across Algeria — orders, carriers, catalogs, reviews and themes, with typed SDKs and an OAuth-secured MCP server.",
    getStarted: "Start building",
    apiReference: "API reference",
    installLabel: "Install the SDKs",
    installCommand: "npm i @wocart/storefront @wocart/theme",
    stats: [
      { value: "OpenAPI 3.1", label: "Generated, typed reference" },
      { value: "58", label: "Wilayas covered" },
      { value: "4", label: "Carrier adapters" },
      { value: "OAuth", label: "MCP authentication" },
    ],
    waysEyebrow: "Choose your entry point",
    waysTitle: "Four ways into Wocart.",
    waysBody:
      "Wocart opens four doors: integrate the REST API, build a storefront, ship a theme merchants can edit, or let an AI client work through MCP. Each path has its own guide and its own reference.",
    cards: [
      {
        icon: <BracesIcon />,
        title: "Platform API",
        description:
          "Orders, shipments, catalogs, customers and store settings behind one typed REST API.",
        href: "/api",
        hint: "GET /api/orders",
        cta: "Explore the API",
      },
      {
        icon: <PackageIcon />,
        title: "Storefront SDK",
        description:
          "The commerce engine: store config, catalog, basket, checkout, reviews and delivery.",
        href: "/sdk/storefront",
        hint: "npm i @wocart/storefront",
        cta: "Read the guide",
      },
      {
        icon: <PaletteIcon />,
        title: "Theme SDK",
        description:
          "Themes merchants edit in Wocart Studio: component definitions, page documents, style and preview, with a starter that creates a complete theme.",
        href: "/sdk/theme",
        hint: "npm i @wocart/theme",
        cta: "Build a theme",
      },
      {
        icon: <BotIcon />,
        title: "MCP server",
        description:
          "Let AI clients read and act on a store through an OAuth-secured Model Context Protocol endpoint.",
        href: "/mcp",
        hint: "OAuth · MCP",
        cta: "Connect a client",
      },
    ],
    quickstart: "Quickstart",
    quickstartTitle: "From zero to your first order.",
    quickstartBody:
      "Create a merchant key, send one request, then explore every endpoint in the interactive playground. Two keys exist, and they never mix: a merchant key acts on your store, a store key only reads what a storefront renders.",
    steps: [
      "Create a merchant API key in the dashboard.",
      "Send your first request with the X-API-Key header.",
      "Explore every endpoint in the interactive playground.",
    ],
    readGuide: "Read the guide",
    authentication: "Authentication",
    keysTitle: "Two keys, one rule",
    keysNote:
      "The merchant key is scoped to your store. The store key never leaves the server.",
    keys: [
      {
        label: "Merchant API",
        detail: "Orders, shipments, catalog",
        command: "X-API-Key: $COD_API_KEY",
      },
      {
        label: "Store API",
        detail: "What a storefront reads",
        command: "X-Store-API-Key: $STORE_API_KEY",
      },
      {
        label: "Typed client",
        detail: "Server-side, one per request",
        command: "npm i @wocart/storefront",
      },
    ],
    asideUrl: "api.codflow.store/store/config",
    asideNote: "Storefront config",
    ctaTitle: "Ship the storefront you want.",
    ctaBody:
      "Build it with Wocart's two SDKs: the storefront SDK for the engine and the theme SDK for the layer merchants edit. The theme starter gives you a complete theme to start from.",
    storefrontSdk: "Storefront SDK",
    themeSdk: "Theme SDK",
    pageTitle: "Wocart Developers — API & SDK documentation",
    pageDescription:
      "API reference and SDK documentation for Wocart, the cash-on-delivery commerce platform for Algeria.",
  },
  fr: {
    eyebrow: "Plateforme développeurs Wocart",
    title: (
      <>
        Wocart — commerce COD, <span className="text-primary">de l'API à la vitrine.</span>
      </>
    ),
    description:
      "Wocart est la plateforme derrière les vitrines en paiement à la livraison partout en Algérie — commandes, transporteurs, catalogues, avis et thèmes, avec des SDK typés et un serveur MCP sécurisé par OAuth.",
    getStarted: "Commencer à intégrer",
    apiReference: "Référence API",
    installLabel: "Installez les SDK",
    installCommand: "npm i @wocart/storefront @wocart/theme",
    stats: [
      { value: "OpenAPI 3.1", label: "Référence typée et générée" },
      { value: "58", label: "Wilayas couvertes" },
      { value: "4", label: "Adaptateurs transporteurs" },
      { value: "OAuth", label: "Authentification MCP" },
    ],
    waysEyebrow: "Choisissez votre point d'entrée",
    waysTitle: "Quatre entrées dans Wocart.",
    waysBody:
      "Wocart ouvre quatre portes : intégrez l'API REST, construisez une vitrine, livrez un thème que les marchands peuvent éditer, ou laissez un client IA agir via MCP. Chaque parcours a son guide et sa référence.",
    cards: [
      {
        icon: <BracesIcon />,
        title: "API de la plateforme",
        description:
          "Commandes, expéditions, catalogues, clients et réglages de boutique derrière une API REST typée.",
        href: "/api",
        hint: "GET /api/orders",
        cta: "Explorer l'API",
      },
      {
        icon: <PackageIcon />,
        title: "SDK Storefront",
        description:
          "Le moteur commerce : configuration, catalogue, panier, commande, avis et livraison.",
        href: "/sdk/storefront",
        hint: "npm i @wocart/storefront",
        cta: "Lire le guide",
      },
      {
        icon: <PaletteIcon />,
        title: "SDK Theme",
        description:
          "Des thèmes que les marchands éditent dans Wocart Studio : définitions de composants, documents de page, style et aperçu, avec un starter qui crée un thème complet.",
        href: "/sdk/theme",
        hint: "npm i @wocart/theme",
        cta: "Construire un thème",
      },
      {
        icon: <BotIcon />,
        title: "Serveur MCP",
        description:
          "Laissez les clients IA lire et agir sur une boutique via un endpoint Model Context Protocol sécurisé par OAuth.",
        href: "/mcp",
        hint: "OAuth · MCP",
        cta: "Connecter un client",
      },
    ],
    quickstart: "Démarrage",
    quickstartTitle: "De zéro à votre première commande.",
    quickstartBody:
      "Créez une clé marchand, envoyez une requête, puis explorez chaque endpoint dans le playground interactif. Il existe deux clés, et elles ne se mélangent jamais : une clé marchand agit sur votre boutique, une clé store ne lit que ce qu'une vitrine affiche.",
    steps: [
      "Créez une clé API marchand dans le tableau de bord.",
      "Envoyez votre première requête avec l'en-tête X-API-Key.",
      "Explorez chaque endpoint dans le playground interactif.",
    ],
    readGuide: "Lire le guide",
    authentication: "Authentification",
    keysTitle: "Deux clés, une règle",
    keysNote:
      "La clé marchand est limitée à votre boutique. La clé store ne quitte jamais le serveur.",
    keys: [
      {
        label: "API marchand",
        detail: "Commandes, expéditions, catalogue",
        command: "X-API-Key: $COD_API_KEY",
      },
      {
        label: "API store",
        detail: "Ce qu'une vitrine lit",
        command: "X-Store-API-Key: $STORE_API_KEY",
      },
      {
        label: "Client typé",
        detail: "Côté serveur, un par requête",
        command: "npm i @wocart/storefront",
      },
    ],
    asideUrl: "api.codflow.store/store/config",
    asideNote: "Configuration de la vitrine",
    ctaTitle: "Livrez la vitrine que vous voulez.",
    ctaBody:
      "Construisez-la avec les deux SDK Wocart : le SDK Storefront pour le moteur et le SDK Theme pour la couche que les marchands éditent. Le starter de thème vous donne un thème complet pour commencer.",
    storefrontSdk: "SDK Storefront",
    themeSdk: "SDK Theme",
    pageTitle: "Wocart Developers — Documentation API et SDK",
    pageDescription:
      "Référence API et documentation des SDK de Wocart, la plateforme de commerce en paiement à la livraison pour l'Algérie.",
  },
  ar: {
    eyebrow: "منصة Wocart للمطوّرين",
    title: (
      <>
        Wocart — تجارة COD، <span className="text-primary">من API إلى واجهة المتجر.</span>
      </>
    ),
    description:
      "Wocart هي المنصة التي تشغّل واجهات المتاجر بالدفع عند الاستلام في الجزائر — الطلبات وشركات التوصيل والكتالوجات والمراجعات والقوالب، مع SDKs مُعرّفة الأنواع وخادم MCP محمي بـ OAuth.",
    getStarted: "ابدأ البناء",
    apiReference: "مرجع API",
    installLabel: "ثبّت الـ SDKين",
    installCommand: "npm i @wocart/storefront @wocart/theme",
    stats: [
      { value: "OpenAPI 3.1", label: "مرجع مُولّد ومُعرّف الأنواع" },
      { value: "58", label: "ولاية مغطاة" },
      { value: "4", label: "مهايئات شركات التوصيل" },
      { value: "OAuth", label: "مصادقة MCP" },
    ],
    waysEyebrow: "اختر نقطة الدخول",
    waysTitle: "أربعة أبواب إلى Wocart.",
    waysBody:
      "تفتح Wocart أربعة أبواب: ادمج REST API، أو ابنِ واجهة متجر، أو أطلق قالبًا يستطيع التجار تعديله، أو دع عميل ذكاء اصطناعي يعمل عبر MCP. لكل مسار دليله ومرجعه.",
    cards: [
      {
        icon: <BracesIcon />,
        title: "API المنصة",
        description:
          "الطلبات والشحنات والكتالوجات والعملاء وإعدادات المتجر خلف API REST واحد مُعرّف الأنواع.",
        href: "/api",
        hint: "GET /api/orders",
        cta: "استكشف API",
      },
      {
        icon: <PackageIcon />,
        title: "SDK واجهة المتجر",
        description:
          "محرك التجارة: إعداد المتجر والكتالوج والسلة وإتمام الطلب والمراجعات والتوصيل.",
        href: "/sdk/storefront",
        hint: "npm i @wocart/storefront",
        cta: "اقرأ الدليل",
      },
      {
        icon: <PaletteIcon />,
        title: "SDK القوالب",
        description:
          "قوالب يحرّرها التجار في Wocart Studio: تعريفات المكوّنات ومستندات الصفحات والتنسيق والمعاينة، مع قالب أساسي ينشئ قالبًا كاملًا.",
        href: "/sdk/theme",
        hint: "npm i @wocart/theme",
        cta: "ابنِ قالبًا",
      },
      {
        icon: <BotIcon />,
        title: "خادم MCP",
        description:
          "دع عملاء الذكاء الاصطناعي يقرؤون ويتصرفون في متجر عبر نقطة نهاية Model Context Protocol محمية بـ OAuth.",
        href: "/mcp",
        hint: "OAuth · MCP",
        cta: "اربط عميلًا",
      },
    ],
    quickstart: "البدء السريع",
    quickstartTitle: "من الصفر إلى أول طلب.",
    quickstartBody:
      "أنشئ مفتاح تاجر، وأرسل طلبًا واحدًا، ثم استكشف كل نقطة نهاية في ساحة التجربة التفاعلية. هناك مفتاحان لا يختلطان: مفتاح التاجر يعمل على متجرك، ومفتاح المتجر لا يقرأ إلا ما تعرضه الواجهة.",
    steps: [
      "أنشئ مفتاح API للتاجر من لوحة التحكم.",
      "أرسل أول طلب مع ترويسة X-API-Key.",
      "استكشف كل نقطة نهاية في ساحة التجربة التفاعلية.",
    ],
    readGuide: "اقرأ الدليل",
    authentication: "المصادقة",
    keysTitle: "مفتاحان، قاعدة واحدة",
    keysNote: "مفتاح التاجر محدود بمتجرك. ومفتاح المتجر لا يغادر الخادم أبدًا.",
    keys: [
      {
        label: "API التاجر",
        detail: "الطلبات والشحنات والكتالوج",
        command: "X-API-Key: $COD_API_KEY",
      },
      {
        label: "API المتجر",
        detail: "ما تقرأه واجهة المتجر",
        command: "X-Store-API-Key: $STORE_API_KEY",
      },
      {
        label: "عميل مُعرّف الأنواع",
        detail: "على الخادم، واحد لكل طلب",
        command: "npm i @wocart/storefront",
      },
    ],
    asideUrl: "api.codflow.store/store/config",
    asideNote: "إعداد واجهة المتجر",
    ctaTitle: "أطلق واجهة المتجر التي تريدها.",
    ctaBody:
      "ابنِها بحزمتَي Wocart: SDK واجهة المتجر للمحرك، وSDK القوالب للطبقة التي يحرّرها التجار. ويمنحك القالب الأساسي قالبًا كاملًا تبدأ منه.",
    storefrontSdk: "SDK واجهة المتجر",
    themeSdk: "SDK القوالب",
    pageTitle: "Wocart Developers — توثيق API وSDK",
    pageDescription:
      "مرجع API وتوثيق SDK لمنصة Wocart للدفع عند الاستلام في الجزائر.",
  },
};

const CONFIG_RESPONSE = `{
  "name": "Dar Zina",
  "lang": "ar",
  "locale": "ar",
  "currency": "DZD",
  "currencySymbol": "دج",
  "cartEnabled": false,
  "reviewsEnabled": true,
  "locales": [
    { "code": "ar", "direction": "rtl" },
    { "code": "fr", "direction": "ltr" }
  ]
}`;

function ConfigPanel({ t }: { t: Copy }) {
  return (
    <BrowserWindow url={`https://${t.asideUrl}`} className="docs-window">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
            GET
          </span>
          <span className="truncate text-muted-foreground">/store/config</span>
          <span className="ms-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
            200 OK
          </span>
        </div>
      </div>
      <pre className="max-h-[340px] overflow-auto p-4 font-mono text-[11.5px] leading-5 text-foreground">
        <code>{CONFIG_RESPONSE}</code>
      </pre>
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {t.asideNote}
      </div>
    </BrowserWindow>
  );
}

function StatStrip({ stats }: { stats: Copy["stats"] }) {
  return (
    <section className="w-full">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card px-5 py-5">
            <p className="font-mono text-lg font-semibold tracking-tight text-foreground">
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WayCard({ card, href }: { card: Card; href: string }) {
  return (
    <Link to={href} className="docs-way group flex flex-col rounded-2xl border bg-card p-5">
      <span className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary [&>svg]:size-5">
        {card.icon}
      </span>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        {card.title}
      </h3>
      <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">
        {card.description}
      </p>
      <code className="mt-4 block truncate rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {card.hint}
      </code>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
        {card.cta}
        <ArrowRightIcon className="docs-arrow size-3.5" />
      </span>
    </Link>
  );
}

function KeysPanel({ t }: { t: Copy }) {
  return (
    <div className="docs-panel overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRoundIcon className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">{t.keysTitle}</span>
      </div>
      <ol className="divide-y">
        {t.keys.map((entry, index) => (
          <li key={entry.label} className="flex items-start gap-3 px-4 py-3.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-muted font-mono text-[10px] text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{entry.label}</p>
              <p className="text-xs text-muted-foreground">{entry.detail}</p>
              <code className="mt-1.5 block truncate font-mono text-[11px] text-primary">
                {entry.command}
              </code>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
        {t.keysNote}
      </p>
    </div>
  );
}

export function Home({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale];
  const href = (path: string) =>
    path === "/api" || locale === "en" ? path : `/${locale}${path}`;

  return (
    <LandingPage
      className="docs-home"
      variant="split"
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          {t.eyebrow}
        </span>
      }
      title={t.title}
      description={t.description}
      actions={[
        { label: t.getStarted, href: href("/getting-started") },
        { label: t.apiReference, href: "/api", variant: "outline" },
      ]}
      aside={<ConfigPanel t={t} />}
    >
      <Head>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Head>

      <div className="w-full -mt-4">
        <div className="flex flex-col gap-2.5 rounded-xl border bg-card/60 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="inline-flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <TerminalIcon className="size-3.5" />
            {t.installLabel}
          </span>
          <code className="docs-copyline truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[12.5px] text-foreground">
            {t.installCommand}
          </code>
        </div>
      </div>

      <StatStrip stats={t.stats} />

      <section className="w-full pt-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {t.waysEyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-foreground">
            {t.waysTitle}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.waysBody}</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.cards.map((card) => (
            <WayCard key={card.title} card={card} href={href(card.href)} />
          ))}
        </div>
      </section>

      <section className="w-full pt-6">
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {t.quickstart}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-foreground">
              {t.quickstartTitle}
            </h2>
            <p className="mt-3 max-w-lg text-muted-foreground">{t.quickstartBody}</p>
            <ol className="mt-7 space-y-4">
              {t.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link to={href("/getting-started")}>
                  {t.readGuide}
                  <ArrowRightIcon className="docs-arrow ms-2 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={href("/authentication")}>{t.authentication}</Link>
              </Button>
            </div>
          </div>
          <KeysPanel t={t} />
        </div>
      </section>

      <section className="w-full">
        <div className="docs-cta rounded-3xl border p-8 md:p-12">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
                {t.ctaTitle}
              </h2>
              <p className="mt-2 max-w-xl text-muted-foreground">{t.ctaBody}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to={href("/sdk/storefront")}>{t.storefrontSdk}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={href("/sdk/theme")}>{t.themeSdk}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </LandingPage>
  );
}
