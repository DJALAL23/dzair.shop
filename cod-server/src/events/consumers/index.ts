/** Every Consumer Kind this platform version can deliver to, by `event_consumers.kind`. */

import type { ConsumerKinds } from "./kind";
import { META_CAPI_KIND, metaCapi } from "./meta-capi";
import { WEBHOOK_KIND } from "../../../../cod-shared/events/webhooks";
import { webhook } from "./webhook";

export const CONSUMER_KINDS: ConsumerKinds = {
  [META_CAPI_KIND]: metaCapi,
  [WEBHOOK_KIND]: webhook,
};
