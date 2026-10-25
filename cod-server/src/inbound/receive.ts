/**
 * Receiving a carrier's webhook: find which company it is for, store its
 * events in the inbox, and answer — nothing else (plan §5.5). Processing
 * happens afterwards, so the carrier always gets its answer in time.
 *
 * The company is the one whose webhook secret verifies the signature, so two
 * companies on the same carrier (two Yalidine accounts) never mix. A delivery
 * no secret verifies is refused: what a carrier reports becomes a Business
 * Event the merchant's systems and customers may be told about, so it must be
 * proven to come from the carrier.
 */

import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { deliveryCompanies } from "@/db/schema";
import type { CarrierProvider } from "@/carriers/contract";
import { carrierCapabilities, carrierWebhook } from "@/carriers/registry";
import { storeInboxEvents } from "../../../cod-shared/inbound/inbox";

export type Received =
  | { status: 200; companyId: string | null; inboxIds: string[]; duplicates: number }
  | { status: 400 | 401; error: string };

export async function receiveWebhook(db: AppDb, provider: CarrierProvider, rawBody: string, headers: Headers): Promise<Received> {
  const webhook = carrierWebhook(provider);
  if (!webhook) return { status: 400, error: `${provider} sends no webhooks` };

  const companies = (
    await db
      .select({ id: deliveryCompanies.id, provider: deliveryCompanies.provider, providerConfig: deliveryCompanies.providerConfig, webhookSecret: deliveryCompanies.webhookSecret })
      .from(deliveryCompanies)
      .where(and(eq(deliveryCompanies.provider, provider), eq(deliveryCompanies.active, true)))
      .all()
  ).filter((company) => carrierCapabilities(company)?.updates === "webhook");
  if (companies.length === 0) {
    console.warn(`[inbound] ${provider} webhook received, but no active ${provider} company takes webhooks`);
    return { status: 200, companyId: null, inboxIds: [], duplicates: 0 };
  }

  let companyId: string | null = null;
  for (const company of companies) {
    if (company.webhookSecret && (await webhook.verify(rawBody, headers, company.webhookSecret))) {
      companyId = company.id;
      break;
    }
  }
  if (!companyId) return { status: 401, error: "The webhook signature matches no company" };

  let envelopes;
  try {
    envelopes = webhook.split(rawBody, headers);
  } catch (error) {
    return { status: 400, error: `Unreadable ${provider} webhook: ${(error as Error)?.message ?? error}` };
  }
  const { stored, duplicates } = await storeInboxEvents(db, { provider, companyId }, envelopes);
  return { status: 200, companyId, inboxIds: stored, duplicates };
}
