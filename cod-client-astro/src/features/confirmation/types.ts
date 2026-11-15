import type { Distribution, PayKind } from "../../../../cod-shared/team/model";

export type { Distribution, PayKind };

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  active: boolean;
  receiving: boolean;
  joinedAt: string;
  waiting: number;
  callbacks: number;
  /** Which orders their permissions let them work. */
  reach: "all" | "own" | "none";
}

/** The confirmation team's queues the orders list can open: new orders with nobody, orders waiting for a manager, orders with someone who left. */
export const TEAM_QUEUES = ["unassigned", "needs_manager", "former"] as const;
export type TeamQueue = (typeof TEAM_QUEUES)[number];

export interface TeamOverview {
  members: TeamMember[];
  unassigned: number;
  needsManager: number;
  /** Orders still waiting with someone who left the team or whose account is inactive. */
  withFormerMembers: number;
}

export interface TeamConfig {
  distribution: Distribution;
  takeBackMinutes: number | null;
  takeBackLimit: number;
}

export interface TeamCandidate {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  reach: "all" | "own" | "none";
}

export interface MemberResults {
  userId: string;
  name: string;
  assigned: number;
  waiting: number;
  confirmed: number;
  cancelled: number;
  delivered: number;
  returned: number;
  confirmationRate: number | null;
  deliveryRate: number | null;
  minutesToDecide: number | null;
  /** Of the cancelled, those cancelled after at least one call without an answer. */
  cancelledAfterNoAnswer: number;
  /** The calls without an answer those orders had. */
  noAnswerCallsBeforeCancel: number;
}

export interface PayRate {
  id: string;
  kind: PayKind;
  amount: number;
  validFrom: string;
}

export interface Commission {
  orders: number;
  amount: number;
  unpriced: number;
}

export interface PayrollLine {
  userId: string;
  name: string;
  /** On the team at some point in the month. */
  onTeam: boolean;
  /** The store day they joined or left, when it fell in the month. */
  joinedOn: string | null;
  leftOn: string | null;
  paySet: boolean;
  salary: number | null;
  confirmed: Commission;
  delivered: Commission;
  total: number;
  incomplete: boolean;
}

export interface AssignmentResult {
  orderId: string;
  ok: boolean;
  changed?: boolean;
  reason?: "order_not_found" | "decided" | "changed";
}
