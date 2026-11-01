/**
 * The English pack, assembled per area.
 */

import type { StoreFrontContent } from "../types";
import { enHome } from "./home";
import { enLayout } from "./layout";
import { enOrderForm } from "./order-form";
import { enOrderSummary } from "./order-summary";
import { enCoupon } from "./coupon";
import { enOtp } from "./otp";
import { enWhatsappWidget } from "./whatsapp-widget";
import { enCart } from "./cart";
import { enReviews } from "./reviews";
import { enOffers } from "./offers";
import { enThankYou } from "./thank-you";
import { enStates } from "./states";
import { enMisc } from "./misc";
import { enProduct } from "./product";
import { enListing } from "./listing";
import { enTrackOrder } from "./track-order";
import { enContact } from "./contact";

export const en: StoreFrontContent = {
  ...enHome,
  ...enLayout,
  ...enOrderForm,
  ...enOrderSummary,
  ...enCoupon,
  ...enOtp,
  ...enWhatsappWidget,
  ...enCart,
  ...enReviews,
  ...enOffers,
  ...enThankYou,
  ...enStates,
  ...enMisc,
  ...enProduct,
  ...enListing,
  ...enTrackOrder,
  ...enContact,
};
