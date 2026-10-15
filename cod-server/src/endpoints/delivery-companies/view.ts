/**
 * A delivery company as the API shows it: its safe fields (`sanitize` in the
 * shared queries) and what its carrier can do, so a client offers only the
 * actions the carrier supports.
 */

import { providerCapabilities } from "@/carriers/registry";
import type { getDeliveryCompanyById } from "./queries";

type SafeCompany = NonNullable<Awaited<ReturnType<typeof getDeliveryCompanyById>>>;

export function companyView(company: SafeCompany) {
  return { ...company, capabilities: providerCapabilities(company.provider, company.providerConfig) };
}
