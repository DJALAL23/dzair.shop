/**
 * StoreFront Content Type
 *
 * One flat record composed from the per-area slices in `./types/`.
 *
 * A `type` (not an `interface`) on purpose: object-literal types get an
 * implicit index signature, so the pack is assignable to the theme contract's
 * `Record<string, string>` content without a cast (Phase 5, slice 15 §10).
 */
import type { HomeStrings } from "./types/home";
import type { LayoutStrings } from "./types/layout";
import type { OrderFormStrings } from "./types/order-form";
import type { OrderSummaryStrings } from "./types/order-summary";
import type { CouponStrings } from "./types/coupon";
import type { OtpStrings } from "./types/otp";
import type { WhatsappWidgetStrings } from "./types/whatsapp-widget";
import type { CartStrings } from "./types/cart";
import type { ReviewsStrings } from "./types/reviews";
import type { OffersStrings } from "./types/offers";
import type { ThankYouStrings } from "./types/thank-you";
import type { StatesStrings } from "./types/states";
import type { MiscStrings } from "./types/misc";
import type { ProductStrings } from "./types/product";
import type { ListingStrings } from "./types/listing";
import type { TrackOrderStrings } from "./types/track-order";
import type { ContactStrings } from "./types/contact";

export type StoreFrontContent = HomeStrings &
  LayoutStrings &
  OrderFormStrings &
  OrderSummaryStrings &
  CouponStrings &
  OtpStrings &
  WhatsappWidgetStrings &
  CartStrings &
  ReviewsStrings &
  OffersStrings &
  ThankYouStrings &
  StatesStrings &
  MiscStrings &
  ProductStrings &
  ListingStrings &
  TrackOrderStrings &
  ContactStrings;
