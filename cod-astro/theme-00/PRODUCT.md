# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Shoppers in Algeria, mostly on phones over mobile data, who arrive from a
Facebook or Instagram ad, a WhatsApp link or a shared product link. They decide
within seconds whether the store is real and whether to order, and they pay cash
on delivery, so trust and speed decide the sale. Arabic is the default
language; French and English are offered when the store publishes them.

The second audience is the merchant who runs the store from the Wocart
dashboard and never touches code: their products, photos, brand color, font,
logo, store name and home-page sections must look good without a designer.

## Product Purpose

Theme-00 is Wocart's default storefront theme: free, installed on every new
store, and the reference every other theme is measured against. It turns a
store's catalog into fast, trustworthy pages that take a shopper from an ad to a
placed cash-on-delivery order with as little friction as possible.

Success: shoppers order (product page → order form → thank-you), pages load fast
on a mid-range phone on 4G, and any merchant's catalog looks professional.

## Positioning

A storefront built for Algerian cash-on-delivery commerce rather than adapted to
it: ordering happens on the product page with wilaya and commune delivery
pricing, WhatsApp OTP confirmation, Arabic right-to-left first, and the
platform's rules (prices, stock, delivery) enforced by the server through the
`@wocart/storefront` SDK.

## Operating Context

- Arrival from paid social: landing pages (`/lp/:slug`) and product pages are
  the most common first screens; the home page and catalog come second.
- One store per deployment, on the merchant's own domain, served by Cloudflare.
- Product photos are merchant-supplied: any aspect ratio, any quality, sometimes
  none at all.
- Optional shopping cart (off by default per store); without it, each product
  page carries its own order form.

## Capabilities and Constraints

- Consumes the platform only through `@wocart/storefront` and `@wocart/theme`
  from npm; theme code never calls the server directly or re-implements a
  platform rule.
- Merchant-controlled and must keep working: brand color, font choice, logo and
  store name, and the editable home sections (page document). All visible
  strings come from the theme's content packs (ar, fr, en) and merchant edits.
- Any category of store: fashion, beauty, electronics, home, general retail.
  The look stays neutral so the merchant's photos and color carry the
  personality.
- Performance is a product requirement: first visit on a phone over 4G must be
  fast (Lighthouse-level budgets), images resized by Cloudflare.

## Brand Commitments

White-label: the storefront carries the merchant's brand, not Wocart's.

## Evidence on Hand

No testimonials, reviews, ratings or trust figures exist beyond what each
store's data provides (product reviews, real delivery prices). Nothing of that
kind may be invented in the design.

## Product Principles

1. Trust in the first screen: a shopper must see a real store, a real product
   and a real price before scrolling.
2. Speed is design: nothing ships that slows a phone on 4G.
3. The merchant's catalog is the hero; the theme frames it and never competes.
4. Arabic right-to-left is the primary layout, not a mirror of a left-to-right
   one.
5. One path to an order, always visible.

## Accessibility & Inclusion

WCAG 2.2 AA contrast and focus visibility for every merchant color; touch
targets sized for one-handed phone use; full right-to-left support.
