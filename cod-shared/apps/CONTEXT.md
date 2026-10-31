# Apps — Context

What a store can add to itself beyond its core: a named product the merchant
turns on, sets up and turns off, and the merchant's own systems connected to
the store. The decision behind it: [ADR 0019](../../docs/adr/0019-apps-run-in-the-store-third-party-apps-stay-outside.md).
The plan: [docs/apps/PLAN.md](../../docs/apps/PLAN.md).

## Language

### What the merchant sees

**App**:
An optional product a store can have, named after what it brings — Meta,
DZVerify, Turnstile, Sendili, the WhatsApp button, Telegram, Reviews. One App,
one page, one on/off, however many things it does inside the store.
_Avoid_: Plugin, extension, add-on, integration, module

**App Key**:
The stable name of an App: lowercase words joined by hyphens (`meta`,
`dzverify`, `whatsapp-button`). It is spelled the same in the App's page, its
API and its permissions, and never changes once released. A Third-party App's
key will carry its Publisher before a dot (`acme.crm`), so the two never meet.
_Avoid_: Slug, app id, handle

**App Page**:
The one screen where a merchant sets up, watches and turns off an App.
_Avoid_: App settings, configuration screen

**App Status**:
Where an App stands for this store: Not set up, On, Off, or Needs attention.
_Avoid_: Installed, active, state

**Feature**:
One thing an App does, with its own switch on the App Page — DZVerify's phone
check at checkout, later its order confirmation on WhatsApp.
_Avoid_: Capability, function, sub-app

**Integration**:
The merchant's own systems connected to the store: their webhooks and their
API key. Not an App: nobody publishes it, the merchant builds it.
_Avoid_: App, connector, native integration

**Core**:
What every store has and cannot turn off — orders, the checkout form,
delivery, the storefront. An App plugs into the Core; it never replaces it.
_Avoid_: Built-in app, system app

### Who makes it

**Publisher**:
Who makes an App. Today only Wocart, whose Apps are First-party.
_Avoid_: Vendor, developer, provider (that names a carrier)

**First-party App**:
An App built into the platform: its code runs inside the store's own server,
open source like the rest.
_Avoid_: Native app, built-in app

**Third-party App** (not built yet):
An App a Publisher other than Wocart makes. It never runs inside the store: it
reaches the store only through permissions the merchant grants and the
Business Events it subscribes to.
_Avoid_: External app, plugin

### How an App plugs in

**Connection Point**:
A place in the Core an App can plug into. There are five: the Checkout Check,
the Storefront Add-on, the Consumer Kind, the Email Sender and the API.
_Avoid_: Hook, extension point, capability

**Checkout Check**:
A Connection Point an order must pass before the store accepts it — Turnstile's
bot check, DZVerify's phone check.
_Avoid_: Guard, gate, middleware

**Storefront Add-on**:
A Connection Point that puts something on the storefront — Meta's pixel,
Turnstile's widget, the WhatsApp button, the review form and list.
_Avoid_: Script, embed, widget

**Email Sender**:
A Connection Point the store sends its own emails through — Sendili.
_Avoid_: Mailer, email provider

## Rules

**An App is named after its product, not its Connection Point**: DZVerify is one
App with a phone check today and an order confirmation later; it is never split
into a "verification" and a "notification".

**A Built-in Consumer belongs to an App**: Meta conversions is the Meta App's,
seen and steered with the Meta App's permission, on the Meta App Page; the
team's Telegram chat is the Telegram App's. The merchant's webhooks are
Integrations.

**An App's secrets are its own columns**: the Telegram bot's token and webhook
secret are kept in `store_telegram_config`, like every App's keys, and never
in a Consumer's settings or an answer (ADR 0020).

**Turning an App off loses nothing**: its setup stays, so turning it on again
works at once. Only removing it forgets its keys.

**An App with nothing to forget is never removed, only turned off**: Reviews
keeps the store's rules for its customers' reviews, no key, so removing it
could only take the reviews with it. It is On or Off, never Not set up. Its
App Page holds the rules; the reviews themselves are moderated under Reviews.
