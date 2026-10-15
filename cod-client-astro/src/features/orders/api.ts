import { apiFetch, apiFetchBlob } from "@/lib/api";
import type {
  AbandonedOrder,
  AbandonedStats,
  BulkHandoff,
  Commune,
  Customer,
  DeliveryCompany,
  DeliveryType,
  Driver,
  HandoffItem,
  OrderDetail,
  OrderListItem,
  OrderPage,
  OrderStage,
  OrderStageCounts,
  OrderStatus,
  Product,
  Shipment,
  ShipmentKind,
  ShipmentRemark,
  ShippingRule,
  StopDesk,
  Wilaya,
} from "./types";
import type { MerchantReport } from "../../../../cod-shared/shipments/merchant-reports";

interface ListEnvelope<T> {
  success: boolean;
  data: T[];
  count?: number;
  total?: number;
}

interface DataEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

function json(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  };
}

/** What narrows the order list — the server filters, so every order is reachable. */
export interface OrderQuery {
  /** One stage or several (a work queue). */
  stages?: readonly OrderStage[];
  attention?: boolean;
  kind?: ShipmentKind;
  orderType?: "online" | "offline";
  wilayaId?: number;
  search?: string;
  limit?: number;
  cursor?: string | null;
}

export async function listOrders(params: OrderQuery = {}): Promise<OrderPage> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 25) });
  if (params.stages?.length) query.set("stage", params.stages.join(","));
  if (params.attention !== undefined) query.set("attention", String(params.attention));
  if (params.kind) query.set("kind", params.kind);
  if (params.orderType) query.set("orderType", params.orderType);
  if (params.wilayaId) query.set("wilayaId", String(params.wilayaId));
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.cursor) query.set("cursor", params.cursor);
  const page = await apiFetch<ListEnvelope<OrderListItem> & { nextCursor: string | null }>(`/api/orders?${query}`);
  return { orders: page.data, nextCursor: page.nextCursor };
}

export async function getOrderStageCounts() {
  return (await apiFetch<DataEnvelope<OrderStageCounts>>("/api/analytics/order-stages")).data;
}

export async function getOrder(id: string) {
  return (await apiFetch<DataEnvelope<OrderDetail>>(`/api/orders/${encodeURIComponent(id)}`)).data;
}

export function updateOrderStatus(id: string, status: OrderStatus) {
  return apiFetch<DataEnvelope<null>>(`/api/orders/${encodeURIComponent(id)}/status`, json({ method: "PATCH", body: JSON.stringify({ status }) }));
}

export async function updateOrder(id: string, body: Record<string, unknown>) {
  return (await apiFetch<DataEnvelope<OrderDetail>>(`/api/orders/${encodeURIComponent(id)}`, json({ method: "PATCH", body: JSON.stringify(body) }))).data;
}

export function deleteOrder(id: string) {
  return apiFetch<DataEnvelope<null>>(`/api/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setLineReturn(orderId: string, lineId: string, returnedQuantity: number) {
  return apiFetch<DataEnvelope<unknown>>(
    `/api/orders/${encodeURIComponent(orderId)}/products/${encodeURIComponent(lineId)}/return`,
    json({ method: "PATCH", body: JSON.stringify({ returnedQuantity }) }),
  );
}

// ─── Handing orders to delivery ─────────────────────────────────────────────

export interface CarrierHandoff {
  kind: "carrier";
  companyId: string;
  deliveryType?: DeliveryType;
  stationCode?: string;
  weight?: number;
  fragile?: boolean;
  remarks?: string;
}

export interface DriverHandoff {
  kind: "driver";
  driverId: string;
  deliveryType?: DeliveryType;
  stationCode?: string;
}

/** Hand one ready order to a carrier or to the store's driver. */
export async function handOffOrder(orderId: string, handoff: CarrierHandoff | DriverHandoff) {
  return (await apiFetch<DataEnvelope<HandoffItem>>(`/api/orders/${encodeURIComponent(orderId)}/shipment`, json({ method: "POST", body: JSON.stringify(handoff) }))).data;
}

export async function handOffToCarrier(companyId: string, orderIds: string[]) {
  return (await apiFetch<DataEnvelope<BulkHandoff>>("/api/shipments/bulk", json({ method: "POST", body: JSON.stringify({ companyId, orderIds }) }))).data;
}

export async function handOffToDriver(driverId: string, orderIds: string[]) {
  return (await apiFetch<DataEnvelope<BulkHandoff>>("/api/shipments/driver-bulk", json({ method: "POST", body: JSON.stringify({ driverId, orderIds }) }))).data;
}

// ─── Acting on a shipment ───────────────────────────────────────────────────

const shipmentPath = (id: string, action = "") => `/api/shipments/${encodeURIComponent(id)}${action}`;

export function validateShipment(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/validate"), json({ method: "POST", body: "{}" }));
}

export function updateParcel(id: string, changes: Record<string, unknown>) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id), json({ method: "PATCH", body: JSON.stringify(changes) }));
}

export function voidShipment(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/void"), { method: "POST" });
}

export type Resolution = { action: "lookup" } | { action: "attach"; trackingNumber: string } | { action: "release" };

/** released: no parcel, the order can be shipped again · not_found: the carrier has none under the order number · accepted / unknown: the parcel's outcome now. */
export async function resolveHandoff(id: string, resolution: Resolution) {
  return (
    await apiFetch<DataEnvelope<{ outcome: "released" | "not_found" | "accepted" | "unknown"; shipment?: Shipment; message?: string }>>(
      shipmentPath(id, "/resolve"),
      json({ method: "POST", body: JSON.stringify(resolution) }),
    )
  ).data;
}

export function reportShipmentEvent(id: string, report: { status: MerchantReport; reason?: string }) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/events"), json({ method: "POST", body: JSON.stringify(report) }));
}

export function syncShipment(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/sync"), { method: "POST" });
}

export function askReturn(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/ask-return"), { method: "POST" });
}

export function requestNewAttempt(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/request-new-attempt"), { method: "POST" });
}

export function confirmReturn(id: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/confirm-return"), { method: "POST" });
}

export async function listRemarks(id: string) {
  return (await apiFetch<DataEnvelope<ShipmentRemark[]>>(shipmentPath(id, "/remarks"))).data;
}

export function addRemark(id: string, content: string) {
  return apiFetch<DataEnvelope<unknown>>(shipmentPath(id, "/remarks"), json({ method: "POST", body: JSON.stringify({ content }) }));
}

export async function downloadLabel(shipment: Pick<Shipment, "id" | "trackingNumber">) {
  const blob = await apiFetchBlob(shipmentPath(shipment.id, "/label"));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${shipment.trackingNumber ?? shipment.id}-label.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function listDrivers() {
  return (await apiFetch<ListEnvelope<Driver>>("/api/drivers?limit=100&offset=0")).data;
}

export async function listDeliveryCompanies(active = true) {
  return (await apiFetch<ListEnvelope<DeliveryCompany>>(`/api/delivery-companies?active=${active}&limit=100&offset=0`)).data;
}

export async function listStopDesks(companyId: string, wilayaId?: number) {
  const query = new URLSearchParams({ activeOnly: "true" });
  if (wilayaId) query.set("wilayaId", String(wilayaId));
  const response = await apiFetch<DataEnvelope<{ stopDesks: StopDesk[] }>>(`/api/delivery-companies/${encodeURIComponent(companyId)}/stop-desks?${query}`);
  return response.data.stopDesks;
}

export async function listCustomers(search = "") {
  const query = new URLSearchParams({ limit: "50", offset: "0" });
  if (search) query.set("search", search);
  return (await apiFetch<ListEnvelope<Customer>>(`/api/customers?${query}`)).data;
}

export async function listProducts() {
  return (await apiFetch<ListEnvelope<Product>>("/api/products?status=ACTIVE&limit=100&offset=0")).data;
}

export async function listWilayas() {
  return (await apiFetch<ListEnvelope<Wilaya>>("/api/wilayas")).data;
}

export async function listCommunes(wilayaId: number) {
  return (await apiFetch<ListEnvelope<Commune>>(`/api/wilayas/${wilayaId}/communes`)).data;
}

export async function getDefaultShippingRules() {
  return (await apiFetch<DataEnvelope<ShippingRule[]>>("/api/shipping-profiles/default/rules")).data;
}

export async function getShippingRules(profileId: string) {
  const response = await apiFetch<DataEnvelope<{ rules: ShippingRule[] }>>(`/api/shipping-profiles/${encodeURIComponent(profileId)}`);
  return response.data.rules;
}

export async function createOrder(body: Record<string, unknown>) {
  return (await apiFetch<DataEnvelope<{ id: string; orderNumber: string }>>("/api/orders", json({ method: "POST", body: JSON.stringify(body) }))).data;
}

export async function listAbandonedOrders(params: { limit?: number; offset?: number; status?: string; search?: string } = {}) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) });
  for (const key of ["status", "search"] as const) if (params[key]) query.set(key, params[key]!);
  return apiFetch<{ success: boolean; data: AbandonedOrder[]; total: number; limit: number; offset: number }>(`/api/abandoned-orders?${query}`);
}

export async function getAbandonedStats() {
  return (await apiFetch<DataEnvelope<AbandonedStats>>("/api/abandoned-orders/stats")).data;
}

export function updateAbandonedStatus(id: string, status: string) {
  return apiFetch<DataEnvelope<null>>(`/api/abandoned-orders/${encodeURIComponent(id)}/status`, json({ method: "PATCH", body: JSON.stringify({ status }) }));
}

export function deleteAbandonedOrder(id: string) {
  return apiFetch<DataEnvelope<null>>(`/api/abandoned-orders/${encodeURIComponent(id)}`, { method: "DELETE" });
}
