---
name: wocart-storefront
description: Build, change and review a custom Astro storefront on the published @wocart/storefront SDK for Wocart cash-on-delivery stores (catalog, basket, checkout, OTP, delivery, reviews, language routing). Use for a storefront that is not edited by merchants; for an editable theme use the wocart-theme skill as well.
---

# Building a Wocart storefront

`@wocart/storefront` is the published boundary between a store's server
(`cod-server`) and your Astro pages. The server owns prices, stock, delivery,
coupons, OTP and whether an order is accepted. Your pages own routes, layout,
copy and interaction.

Documentation: https://docs.wocart.store/sdk/storefront (index for agents:
https://docs.wocart.store/llms.txt; every page also as Markdown at its URL +
`.md`). The installed package's `.d.ts` files are the final authority.

## Versions

`@wocart/storefront` 3.x reads platform v7; pin it exactly
(`npm install --save-exact @wocart/storefront@3.0.0 zod`). A storefront on 2.x
reads a v7 store as unreadable.

## Non-negotiable rules

1. **Verify every API before you use it** in
   `node_modules/@wocart/storefront/dist/*.d.ts`. Published entries only:
   `@wocart/storefront` (browser-safe), `/server`, `/astro`, `/review-media`
   (browser-only). No `dist/…` or `src/…` imports.
2. **The store key never reaches a browser.** `createStoreClient` and
   everything from `/server` and `/astro` run on the server only. Browser
   scripts import the root entry and `/review-media` only.
3. **One module creates the client**, per call (so per request). Pages read the
   request's client; none builds its own.
4. **The server owns money.** Never compute a total, a fee or a discount in the
   browser. `pricePerUnit` and `unitPrice` are display-only. Quote with
   `cart.validate`/`cart.quote` (server) or `createQuoter` (browser, through
   your route).
5. **Reads degrade, they never throw**: `null`, `[]`, `{}` or an empty page.
   Design the empty state; read `onError` to find the cause. `null` from a
   detail read is a real 404: `return notFound(Astro)`.
6. **Writes return a result** (`ClientResult`); branch on `success` and
   `domainError.category`. Never retry an order yourself.
7. **Languages come from `config.locales`**, resolved by
   `resolveStoreRequest` (middleware) and `localizeHref`. Never hardcode a
   language list or branch on `"ar"`.
8. **Every browser request goes through a same-origin route** built with
   `createStorefrontRoutes` or `createProxyEndpoint`, never a hand-written
   proxy or a direct `fetch` to the store API.
9. **Orders go through `placeOrderInput` / `executePlaceOrder`** in an Astro
   action; the middleware runs `runFormAction`; the **page** redirects on
   success with `Astro.getActionResult`. Bind `bindCheckoutKey` to the form.
10. **Respect the store's switches**: render the cart only if
    `config.cartEnabled`, reviews if `reviewsEnabled`, OTP if `otpEnabled`,
    Turnstile if a site key exists. Every WhatsApp link comes from
    `whatsAppContact(config, page, words)` in one module (null: render none);
    the floating launcher also needs
    `showsWidgetOn(contact.surfaces, pathnameWithoutLanguagePrefix)`. Never
    write a `wa.me` link or read `config.whatsapp` yourself.
11. **Checkout policy is the merchant's**: read `config.checkoutForm`
    (`hidden` = render nothing, custom fields keyed by id). Do not re-decide it.
12. **The Purchase event is the server's decision**: fire the pixel and event
    from `orders.tracking(orderId)` with `eventID` = order id, or nothing.
13. **Platform pages have platform paths**: build links with
    `storefrontPath(type, params)` and `localizeHref`, never by hand. Render
    a menu item's `href` as it arrives.
14. **Images are the store's**: resolve them with `config.media`
    (`mediaImageUrl`, `mediaImageSrcset`, `pictureOf`), falling back to the
    original URL; never name a media host.
15. **An unreadable store is `unavailableStoreConfig({ serverUrl, locale })`**,
    never a config written by hand.
16. **No store fact in your own words**: delivery reach, hours, phone,
    address come from the store (`config.contact`, its pages) or nowhere.
17. **Two hosts, one code**: the storefront builds for Cloudflare
    (`@astrojs/cloudflare`, the default) and for Vercel (`@astrojs/vercel`
    when `DEPLOY_TARGET=vercel`), with `session: false` and an image service
    that ships no native binaries (passthrough or the media image service,
    never `sharp`).
18. **No claim without a passing check.** Done means the commands below ran and
    passed, and you quote the result.

## Workflow

1. Read https://docs.wocart.store/sdk/storefront/quickstart.md; create the
   project with exact pins and the same files.
2. Add the request store: middleware with `resolveStoreRequest`, the
   fallback `unavailableStoreConfig(…)`, `Astro.locals.store` (https://docs.wocart.store/sdk/storefront/config.md).
3. Build in this order, running the checks after each step: catalog and
   product pages → same-origin routes → order form and action → basket and
   quote → delivery (wilayas, communes, fee from the quote) → OTP and
   Turnstile → content (pages, menus, landing) → reviews → failure tests.
4. Test every read's failure value and every write's refusal
   (https://docs.wocart.store/sdk/storefront/testing.md).

## Verification (run all, quote the results)

```bash
npx astro check        # 0 errors
npx vitest run         # all passing
npm run build          # Cloudflare build completes
npm run build:vercel   # Vercel build completes
```

With a store available (`COD_SERVER_URL`, `STORE_API_KEY` in `.dev.vars`),
also run `npm run dev` and check: the home page lists
products; a product page renders; an unknown handle answers 404; each
published `/<lang>` renders with the right `lang`/`dir`; a refused order
re-renders the form with its error; a valid order redirects to the thank-you
page; a cross-origin POST to a route answers 403.

## Stop and report instead of proceeding when

- an API you need is not in the installed declarations;
- the only way forward is a deep import, a `@ts-ignore` over an SDK type, or
  copying SDK code;
- a rule would have to be computed in the browser that the server owns;
- you cannot run the verification commands. Say so; never claim success.
