/**
 * Content pack types - product page.
 *
 * Groups: the product's facts (stock, reviews, saving), the delivery note,
 * the offer countdown, the description and policies rows, the order form's
 * three assurances.
 */

import type { Plural } from "./plural";

export type ProductStrings = Plural<"productReviewCount"> & {
  ariaBreadcrumb: string;
  productInStock: string;
  productSaving: string;
  productDeliveryNote: string;
  productCountdownLabel: string;
  productDescriptionTitle: string;
  productPoliciesTitle: string;
  productAssureNoPrepay: string;
  productAssureCall: string;
  productAssureDelivery: string;
};
