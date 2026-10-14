/**
 * The carrier adapters CodFlow ships. A delivery company names one of them as
 * its `provider`; several companies can share one (the EcoTrack platform, the
 * Yalidine platform's Guepex).
 */
export const CARRIER_PROVIDERS = ["yalidine", "zr_express", "noest", "ecotrack"] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];

export function isCarrierProvider(value: unknown): value is CarrierProvider {
  return typeof value === "string" && (CARRIER_PROVIDERS as readonly string[]).includes(value);
}

/** A setting whose value must never leave the server unmasked. */
export function isSecretSetting(key: string): boolean {
  return /secret|token|password/i.test(key);
}

export const MASK = "••••";

/** "••••" and the last four characters: enough to recognize a secret, never to use it. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `${MASK}${secret.slice(-4)}`;
}

export function isMasked(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(MASK);
}

/** Stored provider settings as a response may show them: every secret masked. */
export function maskedSettings(stored: string | null): Record<string, unknown> | null {
  if (!stored) return null;
  let settings: unknown;
  try {
    settings = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  return Object.fromEntries(
    Object.entries(settings as Record<string, unknown>).map(([k, v]) => [k, isSecretSetting(k) && typeof v === "string" ? maskSecret(v) : v]),
  );
}
