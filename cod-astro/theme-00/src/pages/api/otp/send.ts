// OTP step: send the WhatsApp code. Thin binding over the SDK proxy factory.
//
// csrfProtection: false is pre-migration parity — the legacy route had no
// cross-origin check. Flipping it is a deliberate future decision, not a
// silent migration side effect (see the S7 note in slices-plan.md).
import { createProxyEndpoint } from "@wocart/storefront/astro";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

export const POST = createProxyEndpoint({
  method: "POST",
  csrfProtection: false,
  inputSchema: z.object({ phone: z.string().min(1) }),
  client: ({ phone }) => getStoreClient().orders.otp.send(phone),
});
