/**
 * Carrier registry — the one place a configured delivery company becomes an
 * adapter.
 *
 * A company row is one *instance* (credentials, settings) of one *provider*
 * (the adapter that speaks to that carrier's API): several EcoTrack-platform
 * companies share the `ecotrack` adapter, each with its own host and token.
 */

import { CarrierError, type CarrierAdapter, type CarrierProvider } from "./contract";
import { EcotrackCarrier, ecotrackConfigSchema } from "./ecotrack/adapter";
import { NoestCarrier, noestConfigSchema } from "./noest/adapter";
import { YalidineCarrier, yalidineConfigSchema } from "./yalidine/adapter";
import { ZrExpressCarrier, zrConfigSchema, type ZrConfig } from "./zr_express/adapter";

/** What the registry needs from a delivery-company row. */
export interface CarrierCompany {
  code: string;
  apiToken: string | null;
  apiUserGuid: string | null;
  apiEndpoint: string | null;
  notes?: string | null;
  webhookStatusMapping?: string | null;
}

/**
 * Which adapter serves a company code. TEMPORARY until `delivery_companies.provider`
 * exists (plan stage 3): EcoTrack-platform companies are `ecotrack` or
 * `<name>_ecotrack`; Guepex runs on the Yalidine platform.
 */
export function providerOf(code: string): CarrierProvider | null {
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
 * TEMPORARY until `delivery_companies.provider_config` exists (plan stage 3):
 * Yalidine settings live in `notes` JSON (snake_case keys).
 */
function legacyYalidineConfig(company: CarrierCompany): unknown {
  const notes = parseJson(company.notes) as Record<string, unknown> | undefined;
  const platform = company.code === "guepex" ? { platform: "guepex" } : {};
  if (!notes || typeof notes !== "object") return platform;
  return {
    ...platform,
    ...Object.fromEntries(
      Object.entries({
        fromWilayaName: notes.from_wilaya_name,
        proxyBaseUrl: notes.proxy_base_url,
        proxySecret: notes.proxy_secret,
      }).filter(([, v]) => typeof v === "string" && v),
    ),
  };
}

/**
 * TEMPORARY until `provider_config` exists (plan stage 3): the ZR mapping is
 * keyed by the old order statuses. Keys that meant a delivery outcome keep
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
  const provider = providerOf(company.code);
  if (!provider) {
    throw new CarrierError("ecotrack", "misconfigured", `No carrier adapter serves company code "${company.code}"`);
  }
  switch (provider) {
    case "yalidine":
      return new YalidineCarrier(
        { apiId: required(provider, company.apiUserGuid, "The API ID"), apiToken: required(provider, company.apiToken, "The API token") },
        config(provider, yalidineConfigSchema, legacyYalidineConfig(company)),
      );
    case "zr_express":
      return new ZrExpressCarrier(
        { apiKey: required(provider, company.apiToken, "The API key"), tenantId: required(provider, company.apiUserGuid, "The tenant id") },
        config(provider, zrConfigSchema, legacyZrConfig(company)),
      );
    case "noest":
      return new NoestCarrier(
        { apiToken: required(provider, company.apiToken, "The API token"), userGuid: required(provider, company.apiUserGuid, "The user GUID") },
        config(provider, noestConfigSchema, {}),
      );
    case "ecotrack":
      return new EcotrackCarrier(
        { apiToken: required(provider, company.apiToken, "The API token"), baseUrl: required(provider, company.apiEndpoint, "The EcoTrack host") },
        config(provider, ecotrackConfigSchema, {}),
      );
  }
}
