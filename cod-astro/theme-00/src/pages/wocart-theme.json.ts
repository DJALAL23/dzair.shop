// The theme's manifest as a file of every build (`/wocart-theme.json`): what
// an editor and a release read to know this theme's sections, fields,
// templates, settings and text, without running it. Prerendered, so it is
// fixed at build and needs no store.
import { themeManifestEndpoint } from "@wocart/theme/astro";
import { theme00 } from "@/theme/theme";

export const prerender = true;
export const GET = themeManifestEndpoint(theme00);
