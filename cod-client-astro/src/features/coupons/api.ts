import { apiFetch } from "@/lib/api";
import type { Coupon, CouponBody, CouponSummary } from "./types";

interface ListEnvelope<T> {
  success: boolean;
  data: T[];
  count?: number;
}

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

const json = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const path = (id: string) => `/api/coupons/${encodeURIComponent(id)}`;

export async function listCoupons() {
  return (await apiFetch<ListEnvelope<CouponSummary>>("/api/coupons")).data;
}

export async function getCoupon(id: string) {
  return (await apiFetch<DataEnvelope<Coupon>>(path(id))).data;
}

export async function createCoupon(body: CouponBody) {
  return (await apiFetch<DataEnvelope<Coupon>>("/api/coupons", json("POST", body))).data;
}

export async function updateCoupon(id: string, body: Partial<CouponBody>) {
  return (await apiFetch<DataEnvelope<Coupon>>(path(id), json("PATCH", body))).data;
}

export async function deleteCoupon(id: string) {
  await apiFetch<DataEnvelope<null>>(path(id), { method: "DELETE" });
}
