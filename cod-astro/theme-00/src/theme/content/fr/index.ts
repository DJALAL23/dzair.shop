/**
 * The French pack, assembled per area.
 */

import type { StoreFrontContent } from "../types";
import { frHome } from "./home";
import { frLayout } from "./layout";
import { frOrderForm } from "./order-form";
import { frOrderSummary } from "./order-summary";
import { frCoupon } from "./coupon";
import { frOtp } from "./otp";
import { frWhatsappWidget } from "./whatsapp-widget";
import { frCart } from "./cart";
import { frReviews } from "./reviews";
import { frOffers } from "./offers";
import { frThankYou } from "./thank-you";
import { frStates } from "./states";
import { frMisc } from "./misc";

export const fr: StoreFrontContent = {
  ...frHome,
  ...frLayout,
  ...frOrderForm,
  ...frOrderSummary,
  ...frCoupon,
  ...frOtp,
  ...frWhatsappWidget,
  ...frCart,
  ...frReviews,
  ...frOffers,
  ...frThankYou,
  ...frStates,
  ...frMisc,
};
