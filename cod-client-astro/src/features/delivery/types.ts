import type { OrderStage } from "@/features/orders/types";

export type DriverStatus = "available" | "busy" | "inactive";
export type VehicleType = "motorcycle" | "car" | "van";
export type DriverPaymentType = "cod_remittance" | "fee_payment" | "net_settlement";

export interface DriverCashReconciliation {
  pendingCash: number;
  pendingOrdersTotal: number;
  pendingOrdersCount: number;
  drift: number;
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  phone2?: string | null;
  vehicleType?: VehicleType | null;
  status: DriverStatus;
  compensationWilayaCount?: number;
  totalDelivered: number;
  totalEarnings: number;
  pendingCash: number;
  totalPaid: number;
  notes?: string | null;
  /** Orders the driver still has out — not delivered, returned or cancelled. */
  openShipmentCount?: number;
  /** The orders most recently given to the driver, newest first (detail only). */
  recentShipments?: DriverShipment[];
  cashReconciliation?: DriverCashReconciliation;
  createdAt: string;
  updatedAt: string;
}

/** An order given to the driver, as their page lists it. */
export interface DriverShipment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  wilayaId: number | null;
  deliveryType: "home" | "stop_desk";
  codAmount: number;
  driverFee: number;
  providerStatus: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  deliveryAttempts: number;
  stage: OrderStage;
  createdAt: string;
}

/** A delivered shipment whose cash, fee, or both the driver and the store have not settled yet. */
export interface PendingSettlement {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  codAmount: number;
  driverFee: number;
  deliveredAt: string;
  /** The payment that settled its cash; null while the driver still holds it. */
  codPaymentId: string | null;
  /** The payment that settled its fee; null while the store still owes it. */
  feePaymentId: string | null;
}

export interface DriverCompensation {
  wilayaId: number;
  wilayaName?: string;
  wilayaNameAr?: string;
  /** Null for a wilaya the driver has no rate in: the grid lists every wilaya. */
  feePerDelivery: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A wilaya the driver has a rate in. */
export type ConfiguredCompensation = DriverCompensation & { feePerDelivery: number };

export interface DriverPayment {
  id: string;
  driverId: string;
  type: DriverPaymentType;
  amount: number;
  orderCount: number;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export type { Wilaya } from "@/features/geography/types";

export interface DriverFormValues {
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string;
  vehicleType: string;
  notes: string;
}

// ─── Delivery Company Types ───────────────────────────────────────────────────

/** Third-party delivery company (Yalidine, NOEST, ZR Express, etc.). */
export interface DeliveryCompany {
  id: string;
  name: string;
  nameAr: string;
  /** Short unique code, e.g. "yalidine", "noest", "zr_express". */
  code: string;
  website: string | null;
  active: boolean;

  // API integration
  apiEndpoint: string | null;
  /** True when API credentials are stored — credentials themselves are never returned by the API. */
  isConnected: boolean;

  /** The carrier platform behind it; null = it cannot take parcels. */
  provider: CarrierProvider | null;
  /** The platform's settings (secrets masked): Yalidine's sender wilaya, ZR's own state names… */
  providerConfig: Record<string, unknown> | null;
  /** What its carrier can do; null without a provider. */
  capabilities: CarrierCapabilities | null;
  supportsHomeDelivery: boolean;
  supportsStopDesk: boolean;

  /**
   * When true, a created parcel is sent to the courier at once. When false,
   * the team confirms each parcel before it ships (EcoTrack companies).
   */
  autoValidate: boolean;

  /** Free text for the team. */
  notes: string | null;

  // Webhook integration
  /** Whether the webhook signing secret is stored (ZR fetches it; Yalidine's is pasted). The secret never leaves the server. */
  webhookSecretSet: boolean;
  /** ZR only: registered endpoint UUID. null = not registered. */
  webhookEndpointId: string | null;

  createdAt: string;
  updatedAt: string;
}

/** A stop desk / pickup point returned by GET /api/delivery-companies/:id/stop-desks. */
export interface StopDesk {
  id: string;
  companyId: string;
  code: string;
  name: string;
  wilayaId: number | null;
  address: string | null;
  commune: string | null;
  phones: string[];
  active: boolean;
  syncedAt: string;
}

/** Provider configuration registry entry. */
export interface ProviderConfig {
  code: string;
  name: string;
  nameAr: string;
  website: string;
  apiEndpoint: string;
  /** The carrier platform the company runs on, sent when it is connected. */
  provider: CarrierProvider;
  /** Yalidine-platform carriers: which one. */
  platform?: "yalidine" | "guepex";
  /** How its updates reach CodFlow: pushed at once, or checked every few minutes. */
  updates: "webhook" | "pull";
  supportsHomeDelivery: boolean;
  supportsStopDesk: boolean;
  requiresUserGuid: boolean;
  guidLabel?: string;
  guidHint?: string;
  tokenLabel?: string;
  tokenHint?: string;
  requiresFromWilaya?: boolean;
  requiresEndpoint?: boolean;
  endpointLabel?: string;
  endpointHint?: string;
  endpointDefault?: string;
}

// ─── Shipping Profile Types ──────────────────────────────────────────────────

import { ECOTRACK_COURIERS, ecotrackCompanyCode } from "../../../../cod-shared/lib/ecotrack-couriers";
import type { CarrierProvider } from "../../../../cod-shared/carriers/providers";
import type { CarrierCapabilities } from "@/features/orders/types";

/** Per-wilaya rate within a shipping profile. */
export interface ShippingRule {
  id: string;
  profileId: string;
  wilayaId: number;
  wilayaName: string;
  wilayaNameAr: string;
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
  createdAt: string;
}

/**
 * A customer-facing shipping profile (rate card).
 * Profiles only describe what customers pay — driver payroll lives in
 * driver_compensations and is no longer linked to profiles.
 */
export interface ShippingProfile {
  id: string;
  name: string;
  isDefault: boolean;
  notes: string | null;
  ruleCount: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingProfileWithRules
  extends Omit<ShippingProfile, "ruleCount"> {
  rules: ShippingRule[];
}

/** Commune-level override (price + availability) for a wilaya rule. */
export interface CommuneOverride {
  communeId: string;
  communeName: string;
  communeNameAr: string;
  postalCode: string | null;
  homeEnabled: boolean | null;
  stopDeskEnabled: boolean | null;
  homePrice: number | null;
  stopDeskPrice: number | null;
  effectiveHomeEnabled: boolean;
  effectiveStopDeskEnabled: boolean;
  effectiveHomePrice: number;
  effectiveStopDeskPrice: number;
  hasOverride: boolean;
}

/** Per-wilaya rate editor state inside the shipping profile form. */
export interface ShippingRateEntry {
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
}

export type ShippingRateMap = Record<number, ShippingRateEntry>;

/** Form values for creating/editing delivery companies. */
export interface DeliveryCompanyFormValues {
  name: string;
  nameAr: string;
  code: string;
  website: string;
  active: boolean;
  apiToken: string;
  apiUserGuid: string;
  apiEndpoint: string;
  fromWilayaName: string;
}

/**
 * Provider configuration registry.
 *
 * NOTE (2026-09-01): EcoTrack entries are GENERATED from the shared courier
 * catalog (cod-shared/lib/ecotrack-couriers.ts — the same source the
 * cod-server seed uses). Do NOT hand-edit EcoTrack entries here; fix the
 * catalog instead. TODO(later): render the company list from
 * delivery_companies DB rows (seeded by cod-server's
 * seed-ecotrack-companies script) instead of this static registry, so new
 * couriers appear without a dashboard release.
 */
const ECOTRACK_PROVIDER_ENTRIES: Record<string, ProviderConfig> = Object.fromEntries(
  ECOTRACK_COURIERS.map((courier) => [
    ecotrackCompanyCode(courier.key),
    {
      code: ecotrackCompanyCode(courier.key),
      name: courier.name,
      nameAr: courier.nameAr,
      website: courier.baseUrl,
      apiEndpoint: courier.baseUrl,
      supportsHomeDelivery: true,
      supportsStopDesk: true,
      provider: "ecotrack",
      updates: "pull",
      requiresUserGuid: false,
      requiresEndpoint: true,
      endpointDefault: courier.baseUrl,
    } satisfies ProviderConfig,
  ]),
);

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  noest: {
    code: "noest",
    name: "NOEST",
    nameAr: "نوست",
    website: "https://app.noest-dz.com",
    apiEndpoint: "https://app.noest-dz.com",
    provider: "noest",
    updates: "pull",
    supportsHomeDelivery: true,
    supportsStopDesk: true,
    requiresUserGuid: true,
  },
  zr_express: {
    code: "zr_express",
    name: "ZR Express",
    nameAr: "ZR إكسبريس",
    website: "https://zrexpress.app",
    apiEndpoint: "https://api.zrexpress.app",
    provider: "zr_express",
    updates: "webhook",
    supportsHomeDelivery: true,
    supportsStopDesk: true,
    requiresUserGuid: true,
  },
  yalidine: {
    code: "yalidine",
    name: "Yalidine",
    nameAr: "ياليدين",
    website: "https://yalidine.app",
    apiEndpoint: "https://api.yalidine.app/v1",
    provider: "yalidine",
    platform: "yalidine",
    updates: "webhook",
    supportsHomeDelivery: true,
    supportsStopDesk: true,
    requiresUserGuid: true,
    tokenLabel: "X-API-TOKEN",
    tokenHint: "Your Yalidine API token — found in dashboard → API settings",
    guidLabel: "X-API-ID",
    guidHint: "Your Yalidine API ID (numeric) — found in dashboard → API settings",
    requiresFromWilaya: true,
  },
  guepex: {
    code: "guepex",
    name: "Guepex",
    nameAr: "قيباكس",
    website: "https://guepex.app",
    apiEndpoint: "https://api.guepex.app/v1",
    provider: "yalidine",
    platform: "guepex",
    updates: "pull",
    supportsHomeDelivery: true,
    supportsStopDesk: true,
    requiresUserGuid: true,
    tokenLabel: "X-API-TOKEN",
    tokenHint: "Your Guepex API token — found in dashboard → API settings",
    guidLabel: "X-API-ID",
    guidHint: "Your Guepex API ID — found in dashboard → API settings",
    requiresFromWilaya: true,
  },
  ...ECOTRACK_PROVIDER_ENTRIES,
};

/**
 * Returns the ProviderConfig for a company code.
 */
export function getProviderConfig(code: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[code];
}
