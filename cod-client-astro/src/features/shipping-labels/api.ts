/**
 * Shipping labels for the store's own drivers — the dashboard's API client.
 * Calls the API solely through `apiFetch` in `@/lib/api`.
 */

import { apiFetch } from "@/lib/api";
import type { DeliverySheet, LabelSettings, PrintableLabels } from "./types";

interface Envelope<T> {
  success: boolean;
  data: T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function getLabelSettings(): Promise<LabelSettings> {
  return (await apiFetch<Envelope<LabelSettings>>("/api/shipping-labels/settings")).data;
}

export async function saveLabelSettings(config: Record<string, unknown>): Promise<LabelSettings> {
  return (await apiFetch<Envelope<LabelSettings>>("/api/shipping-labels/settings", json("PUT", config))).data;
}

/** The labels of up to 100 driver shipments, in the order asked. */
export async function getDriverLabels(shipmentIds: string[]): Promise<PrintableLabels> {
  return (await apiFetch<Envelope<PrintableLabels>>("/api/shipping-labels", json("POST", { shipmentIds }))).data;
}

/** The parcels still out with a driver. */
export async function getDeliverySheet(driverId: string): Promise<DeliverySheet> {
  return (await apiFetch<Envelope<DeliverySheet>>(`/api/shipping-labels/delivery-sheet/${encodeURIComponent(driverId)}`)).data;
}
