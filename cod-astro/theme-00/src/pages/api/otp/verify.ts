// OTP step: verify the typed code. 422 on an upstream rejection preserves the
// pre-migration contract; the SDK client's error extras (code,
// attemptsRemaining, terminal) ride through the factory untouched.
import { createProxyEndpoint } from "@wocart/storefront/astro";
import { z } from "astro/zod";
import { getStoreClient } from "@/theme/sdk";

export const POST = createProxyEndpoint({
  method: "POST",
  csrfProtection: false,
  errorStatus: 422,
  inputSchema: z.object({
    phone: z.string().min(1),
    requestId: z.string().min(1),
    code: z.string().min(1),
  }),
  client: ({ phone, requestId, code }) =>
    getStoreClient().orders.otp.verify(phone, requestId, code),
});
