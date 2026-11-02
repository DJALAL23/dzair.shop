# Wocart

**The open-source, cash-on-delivery commerce platform for Algeria.**

Wocart was formerly called CodFlow. The repository, packages, environment
variables and live domains still carry the old name where renaming would
break existing stores.

[![Telegram](https://img.shields.io/badge/Telegram-Join%20our%20group-2AABEE?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/codflow_dz)

Run a whole store on your own Cloudflare account: storefront, merchant
dashboard and API on Workers, D1, R2 and KV, with no transaction fees. Ship to
Algeria's carriers or your own drivers, and send Meta the orders that were
really delivered.

**Documentation: [docs.wocart.store](https://docs.wocart.store)**

---

## What is in the box

**Storefront** (`cod-astro/theme-00`, built on the published
[`@wocart/storefront`](https://www.npmjs.com/package/@wocart/storefront) and
[`@wocart/theme`](https://www.npmjs.com/package/@wocart/theme) SDKs)

- One-page cash-on-delivery order form, home delivery or carrier stop desk,
  with live shipping prices
- Arabic (right-to-left), French and English
- Landing pages, collections, offers (gifts, free shipping, quantity pricing)
  and coupons
- An optional shopping cart, off by default
- Reviews from verified orders, with photos and a voice note
- Legal pages (terms, privacy, refunds, shipping), pre-written and editable
- Optional WhatsApp phone verification ([DZVerify](https://dzverify.com)) and
  Cloudflare Turnstile bot protection

**Merchant dashboard** (`cod-client-astro`)

- Orders as work queues, from confirmation to delivery and returns
- Products with variants, stock and low-stock alerts
- Customers, groups and tags; abandoned checkouts
- Team roles with fine-grained permissions, and API keys
- Apps: Meta, DZVerify, Turnstile, Sendili email, WhatsApp button, Telegram
  and Reviews

**Delivery**

- Four carrier platforms behind one contract: Yalidine (and Guepex),
  ZR Express, NOEST and the EcoTrack platform
- Your own drivers, with per-wilaya pay and cash settlement
- Signed webhooks from Yalidine and ZR Express; the others are synced every
  five minutes

**Growth and integration**

- Meta Pixel and Conversions API, with the conversion you choose: `Lead` or
  `Purchase` at order, at confirmation or at delivery
- Signed, retried webhooks for every order and delivery event
- A documented REST API (OpenAPI) and an MCP server for AI agents

## Get started

| I want to… | Read |
| :--- | :--- |
| Run it on my machine | [Local setup](https://docs.wocart.store/self-hosting/local) |
| Put it in production | [Deploy](https://docs.wocart.store/self-hosting/deploy) |
| Set every variable and binding | [Configuration](https://docs.wocart.store/self-hosting/configuration) |
| Choose where images are stored | [Media](https://docs.wocart.store/self-hosting/media) |
| Upgrade a running store | [Upgrading](https://docs.wocart.store/self-hosting/upgrading) |
| Know what is not done yet | [Limitations](https://docs.wocart.store/self-hosting/limitations) |
| Understand how it fits together | [Architecture](https://docs.wocart.store/architecture) |
| Build a theme | [Theme SDK](https://docs.wocart.store/sdk/theme) |
| Build a storefront | [Storefront SDK](https://docs.wocart.store/sdk/storefront) |
| Call the API | [API reference](https://docs.wocart.store/api) |

Features, one page each:
[shopping cart](https://docs.wocart.store/features/cart) ·
[order form](https://docs.wocart.store/features/order-form) ·
[phone verification](https://docs.wocart.store/features/phone-verification) ·
[bot protection](https://docs.wocart.store/features/bot-protection) ·
[Meta](https://docs.wocart.store/features/meta) ·
[legal pages](https://docs.wocart.store/features/legal-pages) ·
[email](https://docs.wocart.store/features/email)

## Repository

| Folder | What it is |
| :--- | :--- |
| `cod-server/` | The API: Hono on Cloudflare Workers, D1 through Drizzle |
| `cod-client-astro/` | The merchant dashboard (Astro) |
| `cod-shared/` | Schema, queries, permissions and error codes shared by both |
| `wocart-sdk/` | The `@wocart/storefront` and `@wocart/theme` packages |
| `cod-astro/theme-00/` | The reference storefront theme |
| `cod-docs/` | The documentation site, in English, French and Arabic |

```sh
npm ci                      # every workspace, from the repo root
cd cod-server && npm test   # and the same in cod-client-astro
npm run verify:sdks         # SDKs and Theme-00 together
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first;
[AGENTS.md](./AGENTS.md) holds the repository's rules for coding agents. Keep
credentials out of commits, and every claim in this README true to the code.

Security issues: see [SECURITY.md](./SECURITY.md). Release notes:
[CHANGELOG.md](./CHANGELOG.md).

## License

[Apache License 2.0](./LICENSE). See also [NOTICE](./NOTICE).

Repository: [github.com/bighadj22/codflow](https://github.com/bighadj22/codflow)
