import { apiFetch } from "@/lib/api";
import type { ActivityWindow, OrderActivity } from "@/features/dashboard/model";

interface DataEnvelope<T> {
  data: T;
}

export async function getOrderActivity(days: ActivityWindow) {
  return (await apiFetch<DataEnvelope<OrderActivity>>(`/api/analytics/order-activity?days=${days}`)).data;
}
