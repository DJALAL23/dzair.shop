/**
 * The Arabic pack, assembled per area.
 */

import type { StoreFrontContent } from "../types";
import { arHome } from "./home";
import { arLayout } from "./layout";
import { arOrderForm } from "./order-form";
import { arOrderSummary } from "./order-summary";
import { arOtp } from "./otp";
import { arWhatsappWidget } from "./whatsapp-widget";
import { arCart } from "./cart";
import { arReviews } from "./reviews";
import { arOffers } from "./offers";
import { arThankYou } from "./thank-you";
import { arStates } from "./states";
import { arMisc } from "./misc";

export const ar: StoreFrontContent = {
  ...arHome,
  ...arLayout,
  ...arOrderForm,
  ...arOrderSummary,
  ...arOtp,
  ...arWhatsappWidget,
  ...arCart,
  ...arReviews,
  ...arOffers,
  ...arThankYou,
  ...arStates,
  ...arMisc,
};
