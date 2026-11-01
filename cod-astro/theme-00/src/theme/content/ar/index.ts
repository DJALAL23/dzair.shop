/**
 * The Arabic pack, assembled per area.
 */

import type { StoreFrontContent } from "../types";
import { arHome } from "./home";
import { arLayout } from "./layout";
import { arOrderForm } from "./order-form";
import { arOrderSummary } from "./order-summary";
import { arCoupon } from "./coupon";
import { arOtp } from "./otp";
import { arWhatsappWidget } from "./whatsapp-widget";
import { arCart } from "./cart";
import { arReviews } from "./reviews";
import { arOffers } from "./offers";
import { arThankYou } from "./thank-you";
import { arStates } from "./states";
import { arMisc } from "./misc";
import { arProduct } from "./product";
import { arListing } from "./listing";
import { arTrackOrder } from "./track-order";
import { arContact } from "./contact";

export const ar: StoreFrontContent = {
  ...arHome,
  ...arLayout,
  ...arOrderForm,
  ...arOrderSummary,
  ...arCoupon,
  ...arOtp,
  ...arWhatsappWidget,
  ...arCart,
  ...arReviews,
  ...arOffers,
  ...arThankYou,
  ...arStates,
  ...arMisc,
  ...arProduct,
  ...arListing,
  ...arTrackOrder,
  ...arContact,
};
