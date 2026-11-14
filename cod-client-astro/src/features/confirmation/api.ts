import { apiFetch } from "@/lib/api";
import type { AssignmentResult, MemberResults, PayKind, PayRate, PayrollLine, TeamCandidate, TeamConfig, TeamMember, TeamOverview } from "./types";

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

export const getTeam = () => data<TeamOverview>("/api/team/members");
export const listCandidates = () => data<TeamCandidate[]>("/api/team/candidates");
export const addTeamMember = (userId: string, receiving: boolean) => data<TeamMember>("/api/team/members", send("POST", { userId, receiving }));
export const setMemberReceiving = (userId: string, receiving: boolean) => data<TeamMember>(`/api/team/members/${encodeURIComponent(userId)}`, send("PATCH", { receiving }));
export const removeTeamMember = (userId: string) => apiFetch(`/api/team/members/${encodeURIComponent(userId)}`, { method: "DELETE" });

export const getMyMembership = () => data<{ member: boolean; receiving: boolean }>("/api/team/me");
export const setMyReceiving = (receiving: boolean) => data<{ member: boolean; receiving: boolean }>("/api/team/me/receiving", send("PUT", { receiving }));

export const shareOutNow = () => data<{ shared: number }>("/api/team/share-out", send("POST", {}));

export const getTeamSettings = () => data<TeamConfig>("/api/team/settings");
export const updateTeamSettings = (config: TeamConfig) => data<TeamConfig>("/api/team/settings", send("PUT", config));

export const getTeamResults = (from: string, to: string) => data<MemberResults[]>(`/api/team/results?${new URLSearchParams({ from, to })}`);

export const listMemberPay = (userId: string) => data<PayRate[]>(`/api/team/members/${encodeURIComponent(userId)}/pay`);
export const setMemberPay = (userId: string, rate: { kind: PayKind; amount: number; validFrom: string }) => data<PayRate>(`/api/team/members/${encodeURIComponent(userId)}/pay`, send("POST", rate));
export const removePayRate = (id: string) => apiFetch(`/api/team/pay/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getPayroll = (month: string) => data<PayrollLine[]>(`/api/team/payroll?${new URLSearchParams({ month })}`);

/** `to`: a member's id, null for nobody, or "rule" for the store's rule. */
export const assignOrders = (orderIds: string[], to: string | null) => data<AssignmentResult[]>("/api/orders/assign", send("POST", { orderIds, to }));
export const setOrderCallback = (orderId: string, at: string | null) => data<{ callbackAt: string | null }>(`/api/orders/${encodeURIComponent(orderId)}/callback`, send("PUT", { at }));
