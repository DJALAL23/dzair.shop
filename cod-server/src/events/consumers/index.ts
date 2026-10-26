/** Every Consumer Kind this platform version can deliver to, by `event_consumers.kind`. */

import type { ConsumerKinds } from "./kind";
import { META_CAPI_KIND, metaCapi } from "./meta-capi";
import { WEBHOOK_KIND } from "../../../../cod-shared/events/webhooks";
import { webhook } from "./webhook";
import { TELEGRAM_KIND } from "../../../../cod-shared/events/telegram";
import { telegram } from "./telegram";

export const CONSUMER_KINDS: ConsumerKinds = {
  [META_CAPI_KIND]: metaCapi,
  [WEBHOOK_KIND]: webhook,
  [TELEGRAM_KIND]: telegram,
};
