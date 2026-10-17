import { apiFetch } from "@/lib/api";
import type { MenuDestinationOption, MenuDetail, MenuItemInput, MenuResourceType, MenuSummary } from "./types";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const path = (id: string) => `/api/menus/${encodeURIComponent(id)}`;

export async function listMenus() {
  return (await apiFetch<DataEnvelope<MenuSummary[]>>("/api/menus")).data;
}

export async function getMenu(id: string) {
  return (await apiFetch<DataEnvelope<MenuDetail>>(path(id))).data;
}

export async function createMenu(body: { handle: string; title: string }) {
  return (await apiFetch<DataEnvelope<MenuDetail>>("/api/menus", json("POST", body))).data;
}

export async function updateMenu(id: string, body: { handle?: string; title?: string }) {
  return (await apiFetch<DataEnvelope<MenuDetail>>(path(id), json("PATCH", body))).data;
}

export async function saveMenuItems(id: string, items: MenuItemInput[]) {
  return (await apiFetch<DataEnvelope<MenuDetail>>(`${path(id)}/items`, json("PUT", { items }))).data;
}

export async function deleteMenu(id: string) {
  await apiFetch<DataEnvelope<{ id: string }>>(path(id), { method: "DELETE" });
}

export async function searchMenuDestinations(type: MenuResourceType, query: string) {
  const search = new URLSearchParams({ type, q: query });
  return (await apiFetch<DataEnvelope<MenuDestinationOption[]>>(`/api/menus/destinations?${search}`)).data;
}
