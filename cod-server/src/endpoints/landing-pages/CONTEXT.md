# Landing Pages Context

The marketing funnel: one-product ad pages built from an image stack, published to their own link. Everything the shopper does after the images — the form, the OTP gate, the offers — belongs to neighboring contexts and is reused, never rebuilt.

## Language

### The Page

**Landing Page**:
A published marketing page for exactly one product: an ordered image stack plus the COD order form. Has a unique public slug and a lifecycle draft → published → archived.
_Avoid_: Variant page, campaign page, funnel

**Landing Page Image**:
One row of the stack — an R2 object with alt text and a position. The entire marketing story (price framing, urgency, benefits) lives inside the images; the page carries no copy fields.
_Avoid_: Banner, hero section, content block

**Landing Page Link**:
The public URL `/lp/<slug>` — the thing the merchant pastes into the ad set. The attribution identity of the page. Server-resolved per deployment from the store's own domain (Store Settings), falling back to the storefront deployment URL, then to a relative path.
_Avoid_: Campaign URL, tracking link, hardcoded domain

**Landing Page Studio**:
The two-sidebar builder: left sidebar uploads and organizes the stack, center shows a live phone-width preview, right sidebar holds the spacing settings. The form is never studio content.
_Avoid_: Page editor, block builder, designer

**Spacing Settings**:
The only adjustable page aesthetic: the gap between stacked images. Cosmetic, per page, deliberately singular.
_Avoid_: Layout options, design settings

**Attribution**:
The landing page an order was placed from, kept on the order. It is the page's only link to what it sold: a landing page counts nothing of its own — no visits, no orders, no revenue — and reporting reads the orders' attribution.
_Avoid_: Stats, scoreboard, views

### Lifecycle

**Draft**:
The page exists but has no public link; the public endpoint answers 404. The Studio's default state.
_Avoid_: Unpublished, hidden

**Published**:
The link is live: shoppers can open it and order from it.
_Avoid_: Active, live (ambiguous with product status)

**Archived**:
The page is retired but its order history stays intact. The only allowed exit for a page that has orders.
_Avoid_: Deleted, disabled

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them:

- **The order form, OTP gate, offers, pricing, wilaya cascade**: Store context. The landing page renders the existing form via the established DOM contract; the charged price is always the catalog price (server-authoritative — no price override exists on landing pages)
- **Image upload plumbing**: the Media Library (`cod-shared/media`, `/api/media`) owns uploads; landing pages upload into its `landing` folder and attach by key
- **Product identity, variants, pricing**: Products context
- **Meta tracking**: the store's tracking settings (Store Settings). A page with its own pixel reports to it, and the order's Attribution is how the Conversions API sends a sale to that pixel

## Edge Cases

**Delete is earned by having no history**: a landing page referenced by any order cannot be deleted — archive instead. Attribution history outlives the page.

**Attribution is best-effort**: an unknown, draft, or archived slug on an order payload leaves attribution empty and the order still succeeds. The order comes first.

**Slugs stay Latin**: the slug charset is [a-z0-9-] even though every other merchant surface is Arabic; the auto-generated default keeps creation frictionless.

**A render writes nothing**: serving a page reads it and changes nothing — the storefront caches pages, so a count taken at render time would measure the cache, not the shoppers.

**Duplicates share image objects**: duplicating a page copies the image rows but not the R2 objects — immutable keys are shared, and an image delete only removes the storage object when the last referencing row goes.

**A duplicate is a new page**: it starts as a fresh draft — attributed orders and published state never carry over.
