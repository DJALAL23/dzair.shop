import { apiFetch } from "@/lib/api";
import type { AppKey } from "../../../../cod-shared/apps/catalog";
import type { AppSummary } from "./types";

export interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

/** A JSON request to one App's own API, under `/api/apps/<key>`. */
export async function appRequest<T>(key: AppKey, path: "" | `/${string}`, method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const url = `/api/apps/${key}${path}`;
  if (method === "GET") return (await apiFetch<DataEnvelope<T>>(url)).data;
  return (await apiFetch<DataEnvelope<T>>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })).data;
}

/** The Apps the signed-in member may see, in catalog order, each with its App Status. */
export async function listApps() {
  return (await apiFetch<DataEnvelope<AppSummary[]>>("/api/apps")).data;
}

/** Forget an App's setup and every key it holds. Whether the outside service it told stopped too, when the App had one to tell. */
export async function removeApp(key: AppKey): Promise<{ updatesStopped: boolean }> {
  const answer = await apiFetch<{ data?: { updatesStopped?: boolean } }>(`/api/apps/${key}`, { method: "DELETE" });
  return { updatesStopped: answer?.data?.updatesStopped ?? true };
}
