import { z } from "@hono/zod-openapi";
import { DISTRIBUTIONS, PAY_KINDS } from "../../../../cod-shared/team/model";

export const TeamMemberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["admin", "staff"]),
    active: z.boolean().openapi({ description: "False once their account is inactive: they receive nothing" }),
    receiving: z.boolean().openapi({ description: "Whether they receive new orders automatically" }),
    joinedAt: z.string(),
    waiting: z.number().int().openapi({ description: "Orders with them still waiting: new, or the customer not reached" }),
    callbacks: z.number().int().openapi({ description: "Of those, the ones with a callback set" }),
    reach: z.enum(["all", "own", "none"]).openapi({ description: "Which orders their permissions let them work: every order, only theirs, or none (they need orders:read or orders:read_assigned)" }),
  })
  .openapi("TeamMember");

export const TeamOverviewSchema = z
  .object({
    members: z.array(TeamMemberSchema),
    unassigned: z.number().int().openapi({ description: "New orders with nobody" }),
    needsManager: z.number().int().openapi({ description: "New orders that moved on as often as the store allows and wait for a manager" }),
    withFormerMembers: z.number().int().openapi({ description: "Orders still waiting with someone who left the team or whose account is inactive; the store's rule gives them back out, under manual a manager does" }),
  })
  .openapi("TeamOverview");

export const TeamCandidateSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["admin", "staff"]),
    reach: z.enum(["all", "own", "none"]).openapi({ description: "Which orders their permissions let them work: every order, only theirs, or none (they need orders:read or orders:read_assigned)" }),
  })
  .openapi("TeamCandidate");

export const TeamConfigSchema = z
  .object({
    distribution: z.enum(DISTRIBUTIONS),
    takeBackMinutes: z.number().int().nullable(),
    takeBackLimit: z.number().int(),
  })
  .openapi("TeamConfig");

export const TeamMembershipSchema = z
  .object({ member: z.boolean(), receiving: z.boolean() })
  .openapi("TeamMembership", { description: "Whether the caller is on the confirmation team, and receiving" });

export const PayRateSchema = z
  .object({ id: z.string(), kind: z.enum(PAY_KINDS), amount: z.number().int(), validFrom: z.string() })
  .openapi("PayRate");

export const MemberResultsSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    assigned: z.number().int().openapi({ description: "Orders placed in the period that are with them now" }),
    waiting: z.number().int(),
    confirmed: z.number().int(),
    cancelled: z.number().int().openapi({ description: "Cancelled without ever being confirmed" }),
    delivered: z.number().int().openapi({ description: "Of the confirmed, delivered" }),
    returned: z.number().int().openapi({ description: "Of the confirmed, come back" }),
    confirmationRate: z.number().int().nullable().openapi({ description: "Confirmed out of those confirmed or cancelled, a whole percent; orders still waiting are left out. Null before any" }),
    deliveryRate: z.number().int().nullable().openapi({ description: "Delivered out of those delivered or come back, a whole percent. Null before any" }),
    minutesToDecide: z.number().int().nullable().openapi({ description: "On average, minutes from getting an order to their first decision on it" }),
    cancelledAfterNoAnswer: z.number().int().openapi({ description: "Of the cancelled (never confirmed), those cancelled after at least one call without an answer" }),
    noAnswerCallsBeforeCancel: z.number().int().openapi({ description: "The calls without an answer those orders had. Divided by `cancelledAfterNoAnswer`: how many times, on average, they were called before being cancelled" }),
  })
  .openapi("MemberResults");

const commission = z.object({ orders: z.number().int(), amount: z.number().int(), unpriced: z.number().int().openapi({ description: "Orders with no rate of this kind in force on their day: not counted in `amount`" }) });

export const PayrollLineSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    onTeam: z.boolean().openapi({ description: "True when they were on the team at some point in the month" }),
    joinedOn: z.string().nullable().openapi({ description: "The store day (YYYY-MM-DD, Algeria) they joined, when it fell in the month" }),
    leftOn: z.string().nullable().openapi({ description: "The store day they left, when it fell in the month" }),
    paySet: z.boolean().openapi({ description: "False when no pay of any kind was ever set for them" }),
    salary: z.number().int().nullable().openapi({ description: "The salary in force on their last day on the team that month, paid whole; null when they have none or were not on the team" }),
    confirmed: commission.openapi({ description: "Orders they confirmed this month, at the per-confirmed rate in force that day" }),
    delivered: commission.openapi({ description: "Orders they confirmed that were delivered this month, at the per-delivered rate in force that day" }),
    total: z.number().int().openapi({ description: "Salary plus commissions; unpriced orders are not in it" }),
    incomplete: z.boolean().openapi({ description: "Something is missing: a member with no pay set, or orders with no rate for a kind they are paid" }),
  })
  .openapi("PayrollLine");

export const AssignmentResultSchema = z
  .object({
    orderId: z.string(),
    ok: z.boolean(),
    changed: z.boolean().optional().openapi({ description: "False when the order was already there (or the rule found nobody else)" }),
    reason: z.enum(["order_not_found", "decided", "changed"]).optional().openapi({ description: "`decided`: the order was already confirmed or cancelled, so who handled it stays as it is. `changed`: the order changed hands or was decided meanwhile; read it again" }),
  })
  .openapi("AssignmentResult");
