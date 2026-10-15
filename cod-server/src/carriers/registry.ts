/**
 * Carrier registry — the one place a configured delivery company becomes an
 * adapter.
 *
 * A company row is one *instance* (credentials, settings) of one *provider*
 * (the adapter that speaks to that carrier's API): several EcoTrack-platform
 * companies share the `ecotrack` adapter, each with its own host and token.
 */

import { isMasked, isSecretSetting } from "../../../cod-shared/carriers/providers";
import { CarrierError, type CarrierAdapter, type CarrierCapabilities, type CarrierProvider, type CarrierWebhook } from "./contract";
import { ECOTRACK_CAPABILITIES, EcotrackCarrier, ecotrackConfigSchema } from "./ecotrack/adapter";
import { NOEST_CAPABILITIES, NoestCarrier, noestConfigSchema } from "./noest/adapter";
import { YalidineCarrier, yalidineCapabilities, yalidineConfigSchema, yalidineWebhook } from "./yalidine/adapter";
import { ZR_CAPABILITIES, ZrExpressCarrier, zrConfigSchema, zrWebhook, type ZrConfig } from "./zr_express/adapter";

/** What the registry needs from a delivery-company row. */
export interface CarrierCompany {
  provider: CarrierProvider | null;
  providerConfig: string | null;
  apiToken: string | null;
  apiUserGuid: string | null;
  apiEndpoint: string | null;
  webhookStatusMapping?: string | null;
}

type ConfigSchema = { safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } };

const CONFIG_SCHEMAS: Record<CarrierProvider, ConfigSchema> = {
  yalidine: yalidineConfigSchema,
  zr_express: zrConfigSchema,
  noest: noestConfigSchema,
  ecotrack: ecotrackConfigSchema,
};

/**
 * The provider a new company gets when none is given, from the dashboard's
 * preset codes. TEMPORARY until the dashboard sends `provider` (plan stage 9):
 * EcoTrack-platform companies are `ecotrack` or `<name>_ecotrack`; Guepex runs
 * on the Yalidine platform.
 */
export function defaultProviderForCode(code: string): CarrierProvider | null {
  if (code === "yalidine" || code === "zr_express" || code === "noest") return code;
  if (code === "guepex") return "yalidine";
  if (code === "ecotrack" || code.endsWith("_ecotrack")) return "ecotrack";
  return null;
}

function misconfigured(provider: CarrierProvider, message: string): CarrierError {
  return new CarrierError(provider, "misconfigured", message);
}

function required(provider: CarrierProvider, value: string | null | undefined, what: string): string {
  if (!value?.trim()) throw misconfigured(provider, `${what} is missing for this ${provider} company`);
  return value.trim();
}

function parseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * TEMPORARY until the inbound pipeline switches (plan stage 5): the ZR mapping
 * still lives in `webhook_status_mapping`, keyed by the old order statuses,
 * because the old webhook handler reads it there. Keys that meant a delivery outcome keep
 * their meaning; every other old order status only ever moved a parcel along.
 */
function legacyZrConfig(company: CarrierCompany): ZrConfig {
  const mapping = parseJson(company.webhookStatusMapping) as Record<string, unknown> | undefined;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return {};
  const statusMap: NonNullable<ZrConfig["statusMap"]> = {};
  for (const [oldKey, names] of Object.entries(mapping)) {
    if (!Array.isArray(names)) continue;
    const meaning =
      oldKey === "delivered" || oldKey === "returned" || oldKey === "out_for_delivery" || oldKey === "cancelled"
        ? oldKey
        : "progress";
    statusMap[meaning] = [...(statusMap[meaning] ?? []), ...names.filter((n): n is string => typeof n === "string")];
  }
  return Object.keys(statusMap).length > 0 ? { statusMap } : {};
}

function config<T>(provider: CarrierProvider, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw misconfigured(provider, `Invalid ${provider} settings: ${parsed.error.message}`);
  return parsed.data;
}

/** The adapter for a company. Throws `misconfigured` when its credentials or settings are incomplete. */
export function buildCarrier(company: CarrierCompany): CarrierAdapter {
  const provider = company.provider;
  if (!provider) {
    throw new CarrierError("ecotrack", "misconfigured", "This company has no carrier adapter; it cannot take parcels");
  }
  const settings = parseJson(company.providerConfig) ?? {};
  switch (provider) {
    case "yalidine":
      return new YalidineCarrier(
        { apiId: required(provider, company.apiUserGuid, "The API ID"), apiToken: required(provider, company.apiToken, "The API token") },
        config(provider, yalidineConfigSchema, settings),
      );
    case "zr_express":
      return new ZrExpressCarrier(
        { apiKey: required(provider, company.apiToken, "The API key"), tenantId: required(provider, company.apiUserGuid, "The tenant id") },
        config(provider, zrConfigSchema, legacyZrConfig(company)),
      );
    case "noest":
      return new NoestCarrier(
        { apiToken: required(provider, company.apiToken, "The API token"), userGuid: required(provider, company.apiUserGuid, "The user GUID") },
        config(provider, noestConfigSchema, settings),
      );
    case "ecotrack":
      return new EcotrackCarrier(
        { apiToken: required(provider, company.apiToken, "The API token"), baseUrl: required(provider, company.apiEndpoint, "The EcoTrack host") },
        config(provider, ecotrackConfigSchema, settings),
      );
  }
}

/**
 * What a company's carrier can do — known from its provider and settings
 * alone, without credentials, so a shipment's possible actions can be shown
 * even while the company is disconnected. Null when it has no adapter.
 */
export function carrierCapabilities(company: Pick<CarrierCompany, "provider" | "providerConfig">): CarrierCapabilities | null {
  switch (company.provider) {
    case null:
      return null;
    case "yalidine": {
      const settings = parseJson(company.providerConfig) as { platform?: unknown } | undefined;
      return yalidineCapabilities(settings?.platform === "guepex" ? "guepex" : "yalidine");
    }
    case "zr_express":
      return ZR_CAPABILITIES;
    case "noest":
      return NOEST_CAPABILITIES;
    case "ecotrack":
      return ECOTRACK_CAPABILITIES;
  }
}

/**
 * How a provider's webhooks are verified, split and read — the same for every
 * company of that provider, and needed before the company is known (it is
 * identified by whose secret verifies the signature). Null for pull-only
 * providers.
 */
export function carrierWebhook(provider: CarrierProvider): CarrierWebhook | null {
  switch (provider) {
    case "yalidine":
      return yalidineWebhook;
    case "zr_express":
      return zrWebhook;
    case "noest":
    case "ecotrack":
      return null;
  }
}

export type SettingsMerge = { ok: true; json: string } | { ok: false; message: string };

/**
 * Apply a settings change from the dashboard onto the stored settings.
 * Keys not mentioned keep their stored value; `null` removes a key; a secret
 * sent back still masked (or omitted) keeps the stored secret — the dashboard
 * only ever sees it masked and must never be able to overwrite it with that.
 * The result is validated by the provider's own schema.
 */
export function mergeProviderConfig(provider: CarrierProvider, stored: string | null, patch: Record<string, unknown>): SettingsMerge {
  const current = (parseJson(stored) as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (isSecretSetting(key) && isMasked(value)) continue;
    else merged[key] = value;
  }
  const parsed = CONFIG_SCHEMAS[provider].safeParse(merged);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; ") };
  }
  return { ok: true, json: JSON.stringify(parsed.data) };
}
