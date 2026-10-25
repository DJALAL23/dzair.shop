/** Every Consumer Kind this platform version can deliver to, by `event_consumers.kind`. */

import type { ConsumerKinds } from "./kind";
import { META_CAPI_KIND, metaCapi } from "./meta-capi";

export const CONSUMER_KINDS: ConsumerKinds = {
  [META_CAPI_KIND]: metaCapi,
};
