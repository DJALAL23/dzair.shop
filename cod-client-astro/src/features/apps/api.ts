import { apiFetch } from "@/lib/api";
import type { AppKey } from "../../../../cod-shared/apps/catalog";
import type { AppSummary } from "./types";

export interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

/** A JSON request to one App's own API, under `/api/apps/<key>`. */
export async function appRequest<T>(key: AppKey, path: "" | "/test", method: "GET" | "PUT" | "POST", body?: unknown): Promise<T> {
  const url = `/api/apps/${key}${path}`;
  if (method === "GET") return (await apiFetch<DataEnvelope<T>>(url)).data;
  return (await apiFetch<DataEnvelope<T>>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })).data;
}

/** The Apps the signed-in member may see, in catalog order, each with its App Status. */
export async function listApps() {
  return (await apiFetch<DataEnvelope<AppSummary[]>>("/api/apps")).data;
}

/** Forget an App's setup and every key it holds. */
export async function removeApp(key: AppKey) {
  await apiFetch(`/api/apps/${key}`, { method: "DELETE" });
}
