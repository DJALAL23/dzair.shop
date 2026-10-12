/**
 * The English pack, assembled per area.
 */

import type { StoreFrontContent } from "../types";
import { enHome } from "./home";
import { enLayout } from "./layout";
import { enOrderForm } from "./order-form";
import { enOrderSummary } from "./order-summary";
import { enOtp } from "./otp";
import { enWhatsappWidget } from "./whatsapp-widget";
import { enCart } from "./cart";
import { enReviews } from "./reviews";
import { enOffers } from "./offers";
import { enThankYou } from "./thank-you";
import { enStates } from "./states";
import { enMisc } from "./misc";

export const en: StoreFrontContent = {
  ...enHome,
  ...enLayout,
  ...enOrderForm,
  ...enOrderSummary,
  ...enOtp,
  ...enWhatsappWidget,
  ...enCart,
  ...enReviews,
  ...enOffers,
  ...enThankYou,
  ...enStates,
  ...enMisc,
};
