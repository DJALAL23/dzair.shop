import type { ZudokuConfig } from "zudoku";
import { Home } from "./src/Home";
import { NotFound } from "./src/NotFound";
import { LocaleSwitcher } from "./src/i18n/LocaleSwitcher";
import docsI18nPlugin from "./src/i18n/plugin";
import "./styles.css";

const config: ZudokuConfig = {
  site: {
    title: "Developers",
    logo: {
      src: {
        light: "/logo-codflow.svg",
        dark: "/logo-codflow-light.svg",
      },
      alt: "CodFlow",
      width: 120,
      height: 40,
      href: "/",
      reloadDocument: false,
    },
    notFoundPage: <NotFound />,
    footer: {
      position: "start",
      logo: {
        src: {
          light: "/logo-codflow.svg",
          dark: "/logo-codflow-light.svg",
        },
        alt: "CodFlow",
        width: 96,
        height: 32,
      },
      columns: [
        {
          title: "Documentation",
          links: [
            { label: "Introduction", href: "/introduction" },
            { label: "Getting started", href: "/getting-started" },
            { label: "Authentication", href: "/authentication" },
            { label: "Webhooks", href: "/webhooks" },
            { label: "Carrier webhooks", href: "/carrier-webhooks" },
            { label: "MCP server", href: "/mcp" },
          ],
        },
        {
          title: "API & SDKs",
          links: [
            { label: "API reference", href: "/api" },
            { label: "Storefront SDK", href: "/sdk/storefront" },
            { label: "Theme SDK", href: "/sdk/theme" },
            { label: "OpenAPI schema", href: "/openapi.json" },
          ],
        },
        {
          title: "Packages",
          links: [
            {
              label: "@wocart/storefront",
              href: "https://www.npmjs.com/package/@wocart/storefront",
            },
            { label: "@wocart/theme", href: "https://www.npmjs.com/package/@wocart/theme" },
            { label: "GitHub", href: "https://github.com/bighadj22/codflow" },
          ],
        },
      ],
      social: [
        {
          icon: "github",
          href: "https://github.com/bighadj22/codflow",
        },
      ],
      copyright: `© ${new Date().getFullYear()} CodFlow. Built for Algerian commerce.`,
    },
  },
  metadata: {
    title: "CodFlow Developers",
    description:
      "API reference and SDK documentation for CodFlow, the cash-on-delivery commerce platform for Algeria.",
    favicon: "/favicon.ico",
    keywords: ["CodFlow", "COD", "Algeria", "ecommerce", "API", "storefront", "delivery"],
    authors: ["CodFlow"],
  },
  syntaxHighlighting: {
    languages: [
      "typescript",
      "ts",
      "javascript",
      "js",
      "json",
      "bash",
      "sh",
      "http",
      "html",
      "astro",
      "php",
      "python",
    ],
  },
  theme: {
    fonts: {
      sans: {
        url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
        fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Arabic', sans-serif",
      },
      mono: "JetBrains Mono",
    },
    light: {
      background: "#ffffff",
      foreground: "#18181b",
      card: "#ffffff",
      cardForeground: "#18181b",
      popover: "#ffffff",
      popoverForeground: "#18181b",
      primary: "#6d28d9",
      primaryForeground: "#ffffff",
      secondary: "#f4f4f5",
      secondaryForeground: "#18181b",
      muted: "#f4f4f5",
      mutedForeground: "#71717a",
      accent: "#f0ebff",
      accentForeground: "#5b21b6",
      destructive: "#dc2626",
      destructiveForeground: "#ffffff",
      border: "#e4e4e7",
      input: "#e4e4e7",
      ring: "#6d28d9",
      radius: "0.75rem",
    },
    dark: {
      background: "#0b0b0f",
      foreground: "#f4f4f5",
      card: "#131318",
      cardForeground: "#f4f4f5",
      popover: "#131318",
      popoverForeground: "#f4f4f5",
      primary: "#a78bfa",
      primaryForeground: "#160d2b",
      secondary: "#1b1b22",
      secondaryForeground: "#f4f4f5",
      muted: "#1b1b22",
      mutedForeground: "#a1a1aa",
      accent: "#2a1b45",
      accentForeground: "#ddd6fe",
      destructive: "#f87171",
      destructiveForeground: "#160d2b",
      border: "#27272f",
      input: "#27272f",
      ring: "#a78bfa",
      radius: "0.75rem",
    },
  },
  plugins: [docsI18nPlugin],
  slots: {
    "head-navigation-end": ({ location }) => (
      <LocaleSwitcher pathname={location.pathname} />
    ),
  },
  navigation: [
    {
      type: "custom-page",
      path: "/",
      element: <Home />,
      display: "hide",
    },
    {
      type: "custom-page",
      path: "/fr",
      element: <Home locale="fr" />,
      display: "hide",
    },
    {
      type: "custom-page",
      path: "/ar",
      element: <Home locale="ar" />,
      display: "hide",
    },
    {
      type: "link",
      label: "Documentation",
      icon: "book-open",
      to: "/introduction",
    },
    {
      type: "link",
      label: "API Reference",
      to: "/api",
      icon: "braces",
    },
    {
      type: "link",
      label: "Storefront SDK",
      icon: "shopping-bag",
      to: "/sdk/storefront",
    },
    {
      type: "link",
      label: "Theme SDK",
      icon: "palette",
      to: "/sdk/theme",
    },
  ],
  docs: {
    files: "pages/**/*.{md,mdx}",
    publishMarkdown: true,
    llms: {
      llmsTxt: true,
      llmsTxtFull: true,
      title: "CodFlow Developers",
      description: "API and SDK documentation for the CodFlow commerce platform.",
      instructions:
        "Use these docs when building on CodFlow: start with getting started and authentication, then use the API reference for request and response schemas. The Storefront SDK and Theme SDK guides cover the published npm packages.",
    },
    defaultOptions: {
      showLastModified: false,
      copyPage: true,
    },
  },
  apis: {
    type: "file",
    input: "./openapi.json",
    path: "/api",
    publish: {
      path: "/openapi.json",
    },
    options: {
      examplesLanguage: "shell",
      supportedLanguages: [
        { value: "shell", label: "cURL" },
        { value: "javascript", label: "JavaScript" },
      ],
      disablePlayground: false,
      disableSecurity: false,
      expandAllTags: false,
      showInfoPage: true,
      schemaDownload: {
        enabled: true,
        fileName: "codflow-openapi",
      },
    },
  },
  search: {
    type: "pagefind",
  },
};

export default config;
