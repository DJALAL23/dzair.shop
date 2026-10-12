#!/usr/bin/env node
/**
 * Build and deploy the storefront worker with COD_SERVER_URL injected from the
 * unified root .env (COD_SERVER_URL) — see cod-server/scripts/cloud-env.mjs.
 * STORE_API_KEY is a worker secret, set separately via `wrangler secret put`.
 *
 * The build runs from here (not from `npm run build`) so ASTRO_KEY — the
 * server-island prop encryption key, also read from the root .env — is present
 * at build time. Without it Astro generates a fresh key per build, and the
 * islands referenced by edge-cached pages (routeRules cache /products/[slug]
 * and /lp/[slug]) cannot be decrypted until the cache expires.
 *
 * COD_SERVER_URL defaults to http://localhost:8787 so `npm run dev` works out
 * of the box. A deployed Worker can never reach that address, so shipping it
 * produces a storefront whose every API call fails. Deployment is refused when
 * the value resolves to localhost unless --force-local is passed.
 *
 * Usage:
 *   npm run deploy
 *   npm run deploy -- --force-local   # intentionally deploy the local value
 */

import { execSync } from "node:child_process";
import { getCloudEnv } from "../../../cod-server/scripts/cloud-env.mjs";

const forceLocal = process.argv.includes("--force-local");
const { serverUrl, astroKey } = getCloudEnv();

/** Loopback hosts a deployed Worker can never reach. */
function isLoopbackUrl(value) {
  let hostname;
  try {
    ({ hostname } = new URL(value));
  } catch {
    return false; // not a URL — let wrangler report it
  }
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

if (isLoopbackUrl(serverUrl) && !forceLocal) {
  console.error(`
Error: COD_SERVER_URL resolves to a local address (${serverUrl}).

A deployed Worker cannot reach your machine, so this would ship a storefront
whose every API call fails.

Set the deployed cod-server origin in <repo-root>/.env:

  COD_SERVER_URL=https://api.yourdomain.com

See <repo-root>/.env.example for the full template, then re-run:

  npm run deploy

To deploy the local value anyway (rarely what you want):

  npm run deploy -- --force-local
`);
  process.exit(1);
}

if (forceLocal && isLoopbackUrl(serverUrl)) {
  console.warn(`Warning: deploying with a local COD_SERVER_URL (${serverUrl}) — --force-local was passed.`);
}

if (!astroKey) {
  console.warn(`
Warning: ASTRO_KEY is not set in the repo-root .env. This build will embed a
fresh server-island encryption key, so islands on pages still in the CDN cache
from the previous deploy cannot be decrypted until that cache expires.

Generate one once with \`npm run key:create\` and add ASTRO_KEY=<value> to
<repo-root>/.env (see .env.example).
`);
}

execSync("npx astro build", {
  stdio: "inherit",
  env: { ...process.env, ...(astroKey ? { ASTRO_KEY: astroKey } : {}) },
});

execSync(`npx wrangler deploy --var COD_SERVER_URL:${serverUrl}`, { stdio: "inherit" });
