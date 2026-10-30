import { getMyStore, updateMyStore } from "./api";
import type { MediaImage } from "../../../../cod-shared/media/model";
import type { StoreConfig, UpdateStoreData } from "./types";

export interface StoreSummary {
  name: string;
  domain: string | null;
  logo: MediaImage | null;
}

const CACHE = "codflow:store-summary";
let read: Promise<StoreSummary> | null = null;
const watchers = new Set<(store: StoreSummary) => void>();

function remember({ name, domain, logo }: StoreSummary): StoreSummary {
  const summary = { name, domain, logo };
  try {
    sessionStorage.setItem(CACHE, JSON.stringify(summary));
  } catch {
    /* storage unavailable */
  }
  return summary;
}

/** The summary an earlier page of this tab saw, shown while this visit's read is on its way. */
export function cachedStoreSummary(): StoreSummary | null {
  try {
    const raw = sessionStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as StoreSummary) : null;
  } catch {
    return null;
  }
}

/**
 * The store's name, domain and logo: read once a visit and shared by every
 * caller, even at the same moment. A read that failed is not kept, so the
 * next one asks again.
 */
export function readStoreSummary(): Promise<StoreSummary> {
  if (!read) {
    const pending = getMyStore().then(remember);
    read = pending;
    pending.catch(() => {
      if (read === pending) read = null;
    });
  }
  return read;
}

/** A save changed the store: everything showing it updates, without reading it again. */
export function storeSummaryChanged(store: StoreSummary): void {
  const summary = remember(store);
  read = Promise.resolve(summary);
  watchers.forEach((watch) => watch(summary));
}

/** Saves the store; everything showing its name, domain or logo shows the saved ones. */
export async function saveMyStore(data: UpdateStoreData): Promise<StoreConfig> {
  const updated = await updateMyStore(data);
  storeSummaryChanged(updated);
  return updated;
}

export function watchStoreSummary(listener: (store: StoreSummary) => void): () => void {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}
