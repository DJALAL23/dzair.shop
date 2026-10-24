import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localUrl = process.env.CODFLOW_LOCAL_URL ?? "http://localhost:8787";
const publicUrl = process.env.CODFLOW_PUBLIC_URL ?? "https://api.codflow.store";
const target = process.env.COD_DOCS_ENV === "production" ? "production" : "local";
const openapiUrl = process.env.COD_OPENAPI_URL ?? `${localUrl}/api/openapi.json`;

const tagDescriptions = {
  Images: "Serve store media from Cloudflare R2.",
  Webhooks: "Receive carrier callbacks and delivery status updates.",
  "Store API": "Public storefront endpoints authenticated with a store API key.",
  Storefront: "Storefront configuration and catalog data used by themes and SDKs.",
  "Activity Logs": "Audit trail of merchant and team actions.",
  Orders: "Create, read, update, archive and export orders.",
  Shipments: "Carrier shipments, tracking numbers and delivery milestones.",
  Users: "Team members, roles, scopes and API keys.",
  Customers: "Customer records, addresses and order history.",
  "Customer Groups": "Group customers for pricing, campaigns and reporting.",
  "Customer Tags": "Tag and segment customers.",
  Drivers: "Delivery drivers and their assignments.",
  Wilayas: "Algerian wilaya and commune reference data.",
  "Delivery Companies": "Carrier accounts, provider configuration and sync.",
  Products: "Catalog products, variants, options and media.",
  "Product Groups": "Group products for storefront merchandising.",
  "Landing Pages": "Build landing pages and product funnels.",
  "Store Pages": "Legal and informational store pages.",
  Navigation: "Storefront menus, links and structure.",
  Collections: "Curated product collections.",
  "Checkout Form": "Checkout fields, validation and display settings.",
  "WhatsApp Widget": "WhatsApp contact widget configuration.",
  "Shipping Profiles": "Delivery zones, rates and shipping rules.",
  "Driver Payments": "Driver settlement lines and payouts.",
  "Store Settings": "Store identity, languages, currency and preferences.",
  Reviews: "Customer reviews, review media and moderation.",
  Offers: "Product offers, bundles and promotional pricing.",
  Coupons: "Discount codes and redemption rules.",
  Stock: "Stock levels, adjustments and movements.",
  Analytics: "Merchant analytics, reports and dashboards.",
  "Abandoned Orders": "Recover abandoned checkouts and baskets.",
};

const tagGroups = [
  {
    name: "Storefront",
    tags: ["Store API", "Storefront", "Webhooks", "Images"],
  },
  {
    name: "Commerce",
    tags: [
      "Orders",
      "Shipments",
      "Products",
      "Product Groups",
      "Collections",
      "Stock",
      "Offers",
      "Coupons",
      "Landing Pages",
      "Reviews",
    ],
  },
  {
    name: "Customers",
    tags: ["Customers", "Customer Groups", "Customer Tags"],
  },
  {
    name: "Delivery",
    tags: ["Drivers", "Driver Payments", "Delivery Companies", "Shipping Profiles", "Wilayas"],
  },
  {
    name: "Store",
    tags: ["Store Settings", "Store Pages", "Navigation", "Checkout Form", "WhatsApp Widget"],
  },
  {
    name: "Operations",
    tags: ["Users", "Activity Logs", "Analytics", "Abandoned Orders"],
  },
];

function readJson(file) {
  return readFile(file, "utf8").then((text) => JSON.parse(text));
}

async function readSpec(url, source) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded with ${response.status}`);
  const spec = await response.json();
  console.log(`[docs] OpenAPI ${spec.info?.version ?? "?"} from ${source}: ${url}`);
  return spec;
}

async function fetchSpec() {
  try {
    return await readSpec(openapiUrl, "local");
  } catch (error) {
    if (process.env.COD_OPENAPI_URL) throw error;
    const fallback = `${publicUrl}/api/openapi.json`;
    console.warn(`[docs] ${openapiUrl} is unreachable (${error.message}); falling back to ${fallback}`);
    return await readSpec(fallback, "production");
  }
}

const apiOverview = `Complete reference for the CodFlow REST API: merchant endpoints under \`/api\`, storefront endpoints under \`/store\`, plus images and webhooks.

## Authentication

Merchant endpoints accept \`X-API-Key\` or \`Authorization: Bearer <JWT>\`. Public storefront endpoints use \`X-Store-API-Key\`. Operations that require a scheme list it.

Read [Authentication](/authentication) for keys, scopes and failure modes, and [Errors](/errors) for the error envelope and retry guidance.

## Responses

JSON operations wrap their payload as \`{ "success": true, "data": ... }\`. List endpoints add a \`count\`; a few paginated lists use \`total\` instead. Image endpoints return binary data and webhook endpoints answer carrier-specific payloads. Each operation's response schema is authoritative.`;

function shapeSpec(spec) {
  const servers =
    target === "production"
      ? [
          { url: publicUrl, description: "Production" },
          { url: localUrl, description: "Local development" },
        ]
      : [
          { url: localUrl, description: "Local development" },
          { url: publicUrl, description: "Production" },
        ];

  spec.servers = servers;

  if (spec.info) {
    spec.info.title = spec.info.title?.trim() || "CodFlow API";
    spec.info.description = apiOverview;
  }

  if (Array.isArray(spec.tags)) {
    spec.tags = spec.tags.map((tag) => ({
      ...tag,
      description: tag.description?.trim() || tagDescriptions[tag.name] || undefined,
    }));
  }

  const grouped = new Set(tagGroups.flatMap((group) => group.tags));
  const ungrouped = (spec.tags ?? []).map((tag) => tag.name).filter((name) => !grouped.has(name));
  if (ungrouped.length > 0) {
    console.warn(`[docs] New tags not in x-tagGroups: ${ungrouped.join(", ")}`);
    tagGroups.find((group) => group.name === "Operations").tags.push(...ungrouped);
  }

  spec["x-tagGroups"] = tagGroups;
  return spec;
}

async function fixLinks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await fixLinks(full);
      continue;
    }

    if (!entry.name.endsWith(".md")) continue;

    const markdown = await readFile(full, "utf8");
    const fixed = markdown.replace(
      /\]\((?!https?:\/\/)([^)#\s]+?)\.md(#[^)]*)?\)/g,
      "]($1$2)",
    );

    if (fixed !== markdown) await writeFile(full, fixed);
  }
}

function assertEntryPoints(label, entryPoints) {
  const missing = entryPoints.filter((entry) => !existsSync(entry));
  if (missing.length > 0) {
    throw new Error(
      `Missing TypeDoc entry points for ${label}. Run npm install in cod-docs first.\n${missing.join("\n")}`,
    );
  }
}

async function runTypedoc(name, entryPoints, out) {
  const typedoc = path.join(root, "node_modules/typedoc/bin/typedoc");
  if (!existsSync(typedoc)) throw new Error("Missing typedoc. Run npm install in cod-docs first.");

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  execFileSync(
    process.execPath,
    [
      typedoc,
      "--plugin",
      "typedoc-plugin-markdown",
      "--entryPoints",
      ...entryPoints,
      "--out",
      out,
      "--tsconfig",
      path.join(root, "scripts/tsconfig.typedoc.json"),
      "--readme",
      "none",
      "--disableSources",
      "--hideGenerator",
      "--skipErrorChecking",
      "--includeVersion",
      "--excludePrivate",
      "--excludeInternal",
      "--name",
      name,
    ],
    { cwd: root, stdio: "inherit" },
  );
}

async function main() {
  const spec = shapeSpec(await fetchSpec());
  await writeFile(path.join(root, "openapi.json"), `${JSON.stringify(spec, null, 2)}\n`);
  console.log("[docs] Wrote openapi.json");

  const storefrontRoot = path.join(root, "node_modules/@wocart/storefront");
  const themeRoot = path.join(root, "node_modules/@wocart/theme");

  const storefrontEntryPoints = [
    path.join(storefrontRoot, "dist/index.d.ts"),
    path.join(storefrontRoot, "dist/server.d.ts"),
    path.join(storefrontRoot, "dist/astro.d.ts"),
    path.join(storefrontRoot, "dist/review-media.d.ts"),
  ];
  const themeEntryPoints = [
    path.join(themeRoot, "dist/index.d.ts"),
    path.join(themeRoot, "dist/astro/index.d.ts"),
    path.join(themeRoot, "dist/image-service.d.ts"),
    path.join(themeRoot, "dist/preview-bridge.d.ts"),
  ];

  assertEntryPoints("@wocart/storefront", storefrontEntryPoints);
  assertEntryPoints("@wocart/theme", themeEntryPoints);

  const storefrontReference = path.join(root, "pages/sdk/storefront/reference");
  const themeReference = path.join(root, "pages/sdk/theme/reference");

  await runTypedoc("@wocart/storefront", storefrontEntryPoints, storefrontReference);
  await runTypedoc("@wocart/theme", themeEntryPoints, themeReference);

  await fixLinks(storefrontReference);
  await fixLinks(themeReference);

  console.log("[docs] Done.");
}

main().catch((error) => {
  console.error(`[docs] ${error.stack ?? error}`);
  process.exitCode = 1;
});
