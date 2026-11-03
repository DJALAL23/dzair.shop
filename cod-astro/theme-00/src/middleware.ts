// Astro requires middleware in src/middleware.ts. This file is framework
// wiring only, and all of it is the SDK's (`createStorefrontMiddleware`):
//
// 1. Store context (Theme Zero S2): `locals.store` is the ONE acquisition
//    point for { config, content, locale, client, href, … } — pages, layouts
//    and components take it from `Astro.locals`, never by building their own.
//    The request's language comes from its path (`/fr/…`), or for a server
//    island or an `/api/*` endpoint from the page that asked for it. A page's
//    notFound() rewrites to /404 and keeps the store it has, so the 404 stays
//    in the shopper's language; a landing page has no `/fr/…` address.
// 2. The form action: an action posted from a form runs before the page that
//    POST renders — the thank-you redirect on success, the form with its
//    error in place on a refusal.
//
// The preview route (`/wocart-preview`, an editor's frame) is the exception:
// its store context is the draft's, and it never runs a form action. The
// revalidation route (`/wocart-revalidate`) needs no store at all.
import { getActionContext } from "astro:actions";
import { createStorefrontMiddleware } from "@wocart/storefront/astro";
import { STORE, storeContext } from "@/theme/runtime/store";
import { PREVIEW } from "@/theme/sdk";

export const onRequest = createStorefrontMiddleware({ ...STORE, preview: PREVIEW, context: storeContext, getActionContext });
