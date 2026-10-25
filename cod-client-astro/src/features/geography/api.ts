import { apiFetch } from "@/lib/api";
import type { Commune, Wilaya } from "./types";

interface ListEnvelope<T> {
  success: boolean;
  data: T[];
}

/**
 * Algeria's wilayas and communes. The server reads them from its migrations,
 * so they are the same for a whole visit: each list is fetched once per page
 * session and shared by every screen that asks, even at the same moment. A
 * read that failed is not kept, so the next one asks again. Each caller gets
 * its own copy of the list.
 */
const lists = new Map<string, Promise<unknown[]>>();

function once<T>(path: string): Promise<T[]> {
  let list = lists.get(path) as Promise<T[]> | undefined;
  if (!list) {
    list = apiFetch<ListEnvelope<T>>(path).then((envelope) => envelope.data);
    lists.set(path, list);
    list.catch(() => {
      if (lists.get(path) === list) lists.delete(path);
    });
  }
  return list.then((items) => [...items]);
}

export function listWilayas(): Promise<Wilaya[]> {
  return once<Wilaya>("/api/wilayas");
}

export function listCommunes(wilayaId: number): Promise<Commune[]> {
  return once<Commune>(`/api/wilayas/${wilayaId}/communes`);
}
