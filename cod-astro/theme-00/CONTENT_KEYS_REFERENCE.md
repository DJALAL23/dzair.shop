# Content Keys Reference

The content keys of the `StoreFrontContent` interface, by area. The interface
lives in `src/theme/content/types.ts` and is implemented exactly by the three
locale files `ar.ts`, `fr.ts`, and `en.ts`. Adding or removing a key means
updating **all three** files — TypeScript fails the build otherwise.

> Icons are **not** content keys. Trust/step icons come from the
> `astro-icon`/Heroicons set (`heroicons:check-badge`, `heroicons:truck`, …)
> configured in `astro.config.mjs` — see `global.css`/components for usage.
> There is no `trust1Icon`/`step1Icon` content key.

## Groups and keys

### Announcement bar (1)
| Key | Notes |
|-----|-------|
| `announcementText` | Fallback text when the store has no announcement bar set |

### Hero (5)
| Key | Notes |
|-----|-------|
| `heroEyebrow` | Eyebrow above the title |
| `heroTitle` | Main hero heading |
| `heroSubtitle` | Hero subheading |
| `heroPlaceholderTitle` | Shown when the store has no products yet |
| `heroPlaceholderSub` | Subtitle for the empty-store hero |

### Trust badges (6)
| Key | Notes |
|-----|-------|
| `trust1Title` / `trust1Sub` | Badge 1 (COD) |
| `trust2Title` / `trust2Sub` | Badge 2 (nationwide delivery) |
| `trust3Title` / `trust3Sub` | Badge 3 (fast confirmation) |

### Hero CTAs (2)
| Key | Notes |
|-----|-------|
| `heroCtaPrimary` | Primary CTA ("Shop Now") |
| `heroCtaSecondary` | Secondary CTA ("View Best Sellers") |

### Navigation (5)
| Key | Notes |
|-----|-------|
| `navHome`, `navProducts`, `navNewArrivals`, `navBestSellers`, `navCategories` | Header + mobile nav labels |

### Section headings (8)
| Key | Notes |
|-----|-------|
| `categoriesSection` | "Shop by Category" |
| `featuredSection` | Featured-products heading |
| `allProductsSection` | All-products heading |
| `bestSellersSection` / `bestSellersSub` | Best-sellers heading + subtitle |
| `newArrivalsSection` / `newArrivalsSub` | New-arrivals heading + subtitle |
| `viewAllCta` | "View all" link on section headers |

### How It Works — COD trust (8)
| Key | Notes |
|-----|-------|
| `howItWorksTitle` / `howItWorksSub` | Section heading + subtitle |
| `howStep1Title` / `howStep1Sub` | Place order |
| `howStep2Title` / `howStep2Sub` | Confirm via WhatsApp |
| `howStep3Title` / `howStep3Sub` | Pay cash on delivery |

### Features bar (4)
| Key | Notes |
|-----|-------|
| `feature1Title`, `feature2Title`, `feature3Title`, `feature5Title` | Trust strip titles (note: there is no `feature4Title`) |

### Promo banner (3)
| Key | Notes |
|-----|-------|
| `promoTitle`, `promoSub`, `promoCtaText` | WhatsApp CTA banner |

### Testimonials (2)
| Key | Notes |
|-----|-------|
| `testimonialsTitle`, `testimonialsSub` | Review/testimonial section |

### Editor sections (6)
| Key | Notes |
|-----|-------|
| `bannerTitle`, `bannerCta` | Image banner: title and button |
| `richTextTitle` | Rich-text block title |
| `faqTitle` | FAQ title (the questions are the merchant's) |
| `featuredProductTitle`, `featuredProductCta` | Featured product: title and button |

### Footer (6)
| Key | Notes |
|-----|-------|
| `footerAbout`, `footerQuickLinks`, `footerSupport`, `footerShipping`, `footerReturns`, `footerRights` | Footer headings + copyright line |

### Order form (23)
| Key | Notes |
|-----|-------|
| `orderCta` / `orderCtaSubtext` | Product-card CTA + "Cash on delivery" subtext |
| `formTitle` | Form heading |
| `formDeliverySection` | Delivery-info section label |
| `formNameLabel` / `formNamePlaceholder` | Full name |
| `formPhoneLabel` / `formPhonePlaceholder` | Phone |
| `formWilayaLabel` / `formWilayaPlaceholder` | Wilaya selector |
| `formCommuneLabel` / `formCommunePlaceholder` | Commune selector |
| `formCommuneLoading` | Loading state |
| `formCommuneDisabled` | "Select a wilaya first" |
| `formAddressLabel` / `formAddressPlaceholder` | Detailed address |
| `formDeliveryLabel` | Delivery method label |
| `formHomeDelivery` / `formStopDesk` | Delivery method options |
| `formNotesLabel` / `formNotesPlaceholder` | Order notes |
| `formSubmit` | Submit button |
| `formConfirmNote` | Post-submit confirmation note |

### Order summary (7)
| Key | Notes |
|-----|-------|
| `qtyLabel`, `qtyUnit` | Quantity + unit label |
| `shippingLabel` | Delivery fee label |
| `shippingCalculated` | "Calculated after selecting wilaya" |
| `shippingFree` | Free-shipping label |
| `totalLabel`, `itemsLabel` | Totals |

### Thank-you page (12)
| Key | Notes |
|-----|-------|
| `thankYouTitle`, `thankYouSubtitle` | Page heading + subtitle |
| `orderNumberLabel`, `totalAmountLabel` | Order/total field labels |
| `codNote` | "No prepayment required" |
| `step1Title` / `step1Sub`, `step2Title` / `step2Sub`, `step3Title` / `step3Sub` | "What happens next" steps |
| `backToStore` | Return link |

### Empty / error states (5)
| Key | Notes |
|-----|-------|
| `noProductsTitle`, `noProductsSub` | Empty category |
| `emptyStoreTitle`, `emptyStoreSub` | Empty store |
| `productNotFoundTitle` | Product 404 |

### Reviews (18)
| Key | Notes |
|-----|-------|
| `reviewsTitle`, `reviewsNoReviews`, `reviewsBeFirst`, `reviewsVerifiedBuyer` | Reviews section |
| `reviewFormTitle` | Form heading |
| `reviewFormOrderLabel` / `reviewFormOrderPlaceholder` / `reviewFormOrderHelp` | Order-number field |
| `reviewFormRatingLabel` | Rating field |
| `reviewFormTitleLabel` / `reviewFormTitlePlaceholder` | Review-title field |
| `reviewFormBodyLabel` / `reviewFormBodyPlaceholder` | Review body |
| `reviewFormSubmit` | Submit button |
| `reviewFormSuccess` | Post-submit message |
| `reviewFormErrorDuplicate` | Duplicate-review error |
| `reviewFormErrorInvalidOrder` | Order-not-found error |
| `reviewFormErrorGeneric` | Generic error |

### Offers (10)
| Key | Notes |
|-----|-------|
| `offerAutoApplied` | "Automatically applied at checkout" |
| `offerFreeLabel` | Free-item label |
| `offerActive` | Card header before threshold |
| `offerUnlocked` | Card header when unlocked |
| `offerYouGet` | Free-item hint when unlocked |
| `offerSectionTitle` | Offer selector heading |
| `offerFreeShippingBadge` | Free-shipping badge |
| `offerBuyOne` | Base tier label |
| `offerFullPrice` | Base tier badge |
| `offerMostPopular` | Tier badge |

### Misc (28)
| Key | Notes |
|-----|-------|
| `breadcrumbHome` | Breadcrumb home link |
| `required` | Required-field indicator |
| `viewProduct`, `featured` | Link/badge text |
| `lowStock_*`, `outOfStock`, `qtyMaxStock_*` | Stock warnings (`lowStock` and `qtyMaxStock` are plural messages with `{count}`) |
| `freeShippingBadge` | Badge text |
| `searchLabel`, `noResultsLabel`, `loadMoreLabel`, `allLabel`, `productCountLabel` | Search/filter/pagination |
| `reviewFormMinLengthError`, `reviewFormRatingRequired` | Review validation errors |
| `offerSaveBadge`, `offerSavingsText`, `offerUnitLabel` | Offer savings UI (`offerSaveBadge` uses `{n}`; `offerSavingsText` uses `{amount}` + `{currency}`; `offerUnitLabel` uses `{n}`) |
| `ariaMainNavigation`, `ariaLanguageSwitcher`, `ariaQuantity`, `ariaGoToImage`, `ariaBrowseAllProducts`, `ariaBrowseCategoryProducts`, `ariaProductCard`, `ariaStarRating_*` | Accessibility labels (`ariaStarRating` is a plural message) |
| `thankYouPageTitle` | `<title>` for the thank-you page |
| `defaultMetaDescription` | Default meta description — uses `{storeName}` |

## Placeholders and plurals

Every key with a placeholder or a count is read through the theme's one
binding, `message(content, key, values, locale)` (`src/theme/content/messages.ts`,
built on `formatMessage` from `@wocart/theme`) — never `.replace()`, which fills
only the first placeholder and cannot pick a plural form
(`guards/messages.test.ts` enforces it). Every `{placeholder}` is filled, and
numbers use the theme's digits.

- **Plural messages** are one key per CLDR form, chosen by `count`:
  `cartItems`, `cartLineOutOfStock`, `lowStock`, `qtyMaxStock`,
  `ariaStarRating`. Each language carries exactly the forms its rules use —
  Arabic `_zero _one _two _few _many _other`, French `_one _many _other`,
  English `_one _other` — and an explicit `_zero` is used for 0 in any
  language. `packs.test.ts` checks every pack against its language.
- `{n}` — `offerSaveBadge`, `offerUnitLabel`, `ariaGoToImage` (with `{total}`)
- `{amount}` + `{currency}` — `offerSavingsText`, `cartFreeDeliveryRemaining`
- `{storeName}` — `defaultMetaDescription`

A browser script receives a plural message as `data-*={messageData(content, key)}`
and formats it with `embeddedMessage`, in the page's `<html lang>`.

## Sample defaults

| Key | AR (default) | EN |
|-----|--------------|----|
| `heroTitle` | اكتشف أفضل المنتجات | Discover amazing products |
| `heroSubtitle` | توصيل لجميع ولايات الجزائر — الدفع عند الاستلام | Delivery to all wilayas in Algeria — Cash on delivery |
| `trust1Title` / `trust1Sub` | الدفع عند الاستلام / بدون دفع مسبق | Cash on Delivery / No prepayment |
| `orderCta` | اطلب الآن | Order Now |
| `formSubmit` | تأكيد الطلب | Confirm order |
| `totalLabel` | المجموع الكلي | Total |

The complete AR/FR/EN defaults live in `src/theme/content/{ar,en,fr}/` — one
file per area (`home.ts`, `order-form.ts`, `cart.ts`, …), with the shared key
set typed in `src/theme/content/types/`.

## Override via the dashboard

Store owners can override any key per language. The edits belong to this
theme: cod-server stores them under its key (`theme-00`, `src/theme/key.ts`),
and the SDK client names that key, so they arrive as
`StoreConfig.contentOverrides` (→ `resolveContent(lang, overrides)` in
`src/theme/content/index.ts`). Only the store's own language is applied;
unknown keys and non-string values are ignored and the locale defaults are
used. They are written by CodFlow Cloud's visual editor (closed source, not
part of this repository); cod-server only stores and serves them, already
grouped per language:

```json
{ "ar": { "heroTitle": "عرض اليوم" }, "fr": { "heroTitle": "L'offre du jour" } }
```

A store language this theme has no pack for (say Tamazight) still renders: its
edits apply over the `DEFAULT_LANGUAGE` pack.

## Adding a language

1. Add the key to `src/theme/content/types.ts` and fill it in `ar.ts`, `fr.ts`,
   `en.ts` (all three must stay exact).
2. Create `xx.ts` typed as `StoreFrontContent`.
3. Register it in the `languages` object in `src/theme/content/index.ts`.
4. Add the code to the `lang` enum in `cod-shared` (`stores.lang`) and the SDK's
   `StoreConfig.lang` contract (`@wocart/storefront`). Today the schema exposes
   `"ar" | "en"`.