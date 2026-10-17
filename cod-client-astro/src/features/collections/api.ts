import { apiFetch } from "@/lib/api";
import type { CollectionDetail, CollectionSummary } from "./types";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const path = (id: string) => `/api/collections/${encodeURIComponent(id)}`;

export async function listCollections() {
  return (await apiFetch<DataEnvelope<CollectionSummary[]>>("/api/collections")).data;
}

export async function getCollection(id: string) {
  return (await apiFetch<DataEnvelope<CollectionDetail>>(path(id))).data;
}

export async function createCollection(body: { handle: string; title: string; description?: string | null }) {
  return (await apiFetch<DataEnvelope<CollectionDetail>>("/api/collections", json("POST", body))).data;
}

export async function updateCollection(id: string, body: { handle?: string; title?: string; description?: string | null }) {
  return (await apiFetch<DataEnvelope<CollectionDetail>>(path(id), json("PATCH", body))).data;
}

export async function saveCollectionProducts(id: string, productIds: string[]) {
  return (await apiFetch<DataEnvelope<CollectionDetail>>(`${path(id)}/products`, json("PUT", { productIds }))).data;
}

export async function deleteCollection(id: string) {
  await apiFetch<DataEnvelope<{ id: string }>>(path(id), { method: "DELETE" });
}
