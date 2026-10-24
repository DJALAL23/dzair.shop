/**
 * Landing-page sticky "Order Now" CTA (theme layer).
 * Preserved for backwards compatibility with landing page templates.
 */

import { initStickyCta } from "./sticky-cta";
import { onEachPage } from "@wocart/theme/lifecycle";

export { initStickyCta, initStickyCta as initLpStickyCta };

onEachPage(() => initStickyCta());
