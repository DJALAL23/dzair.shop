/**
 * Meta Pixel PageView for each client-side navigation.
 *
 * The pixel's base code reports the first PageView when the document loads. A
 * soft navigation swaps the page without loading that code again, so every page
 * reached that way is reported here instead. A store without a pixel has no
 * `fbq`, and nothing happens.
 */

import { onEachPage } from "@wocart/theme/lifecycle";
import { fbqSafe } from "./pixel";

let firstPage = true;

onEachPage(() => {
  if (firstPage) {
    firstPage = false;
    return;
  }
  fbqSafe()?.("track", "PageView");
});
