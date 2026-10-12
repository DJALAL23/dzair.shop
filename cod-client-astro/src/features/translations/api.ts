import { apiFetch } from "@/lib/api";
import { translationsPath } from "./model";
import type { TranslatableResource, TranslationPatch, TranslationView } from "./types";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

export async function getTranslations(resource: TranslatableResource, id: string) {
  return (await apiFetch<DataEnvelope<TranslationView>>(translationsPath(resource, id))).data;
}

export async function saveTranslations(resource: TranslatableResource, id: string, patch: TranslationPatch) {
  return (
    await apiFetch<DataEnvelope<TranslationView>>(translationsPath(resource, id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  ).data;
}
