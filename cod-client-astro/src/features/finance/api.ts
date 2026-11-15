import { apiFetch } from "@/lib/api";
import type { Cost, CostInput, CostsSummary, ExchangeRate, ForeignCurrency } from "./types";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const data = async <T>(path: string, init?: RequestInit) => (await apiFetch<DataEnvelope<T>>(path, init)).data;

export const listCosts = () => data<Cost[]>("/api/finance/costs");
export const getCostsSummary = (from: string, to: string) => data<CostsSummary>(`/api/finance/costs/summary?${new URLSearchParams({ from, to })}`);
export const createCost = (input: CostInput) => data<Cost>("/api/finance/costs", send("POST", input));
/** A change to the cost as `revision` showed it; refused (COST_CHANGED) when it changed since. */
export const updateCost = (id: string, input: CostInput, revision: string) => data<Cost>(`/api/finance/costs/${encodeURIComponent(id)}`, send("PUT", { ...input, revision }));
export const deleteCost = (id: string) => apiFetch(`/api/finance/costs/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listRates = () => data<ExchangeRate[]>("/api/finance/rates");
export const setRate = (rate: { currency: ForeignCurrency; dzdPerUnit: number; validFrom: string }) => data<ExchangeRate>("/api/finance/rates", send("POST", rate));
export const removeRate = (id: string) => apiFetch(`/api/finance/rates/${encodeURIComponent(id)}`, { method: "DELETE" });
