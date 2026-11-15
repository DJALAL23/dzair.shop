/**
 * The store's own costs and exchange rates (cod-shared/finance). Amounts go
 * out and come in as major units (12.5 dollars, 30000 dinars); the database
 * keeps minor units. A summary is in dinars.
 */
import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { logActivity, ACTIONS } from "@/lib/activity";
import { BusinessLogicError, ConflictError, NotFoundError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { fromMinor, toMinor } from "../../../../cod-shared/finance/model";
import * as finance from "../../../../cod-shared/finance/queries";
import { storeDayOf } from "../../../../cod-shared/time/store-day";
import type * as v from "./validation";

const valid = <T>(c: Context<AppContext>, target: "json" | "query" | "param") => (c.req as unknown as { valid: (t: string) => T }).valid(target);

const costView = ({ amountMinor, history, ...cost }: finance.CostSeries) => ({
  ...cost,
  amount: fromMinor(amountMinor),
  history: history.map(({ amountMinor: minor, ...entry }) => ({ ...entry, amount: fromMinor(minor) })),
});

const rateView = ({ centimesPerUnit, ...rate }: finance.RateRow) => ({ ...rate, dzdPerUnit: fromMinor(centimesPerUnit) });

function refusal(reason: finance.CostRefusal["reason"], id: string, productId?: string | null) {
  if (reason === "not_found") return new NotFoundError("Cost", id);
  if (reason === "product_not_found") return new NotFoundError("Product", productId ?? undefined);
  if (reason === "has_history") return new BusinessLogicError("A cost that had other amounts before cannot become a one-time cost, nor stop being one", ERROR_CODES.COST_HAS_HISTORY, { id });
  if (reason === "changed") return new ConflictError("The cost was changed or deleted meanwhile; nothing was written. Read it again and retry", ERROR_CODES.COST_CHANGED, { id });
  return new BusinessLogicError("The days do not fit: a cost stops on or after it starts, and a change applies from today at the latest, while the cost runs", ERROR_CODES.COST_DATES_INVALID, { id });
}

/** GET /finance/costs */
export async function listCosts(c: Context<AppContext>) {
  return c.json({ success: true, data: (await finance.listCosts(getDb(c.env.DB))).map(costView) }, 200);
}

/** POST /finance/costs */
export async function createCost(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { amount, ...body } = valid<z.infer<typeof v.costSchema>>(c, "json");
  const created = await finance.createCost(db, { ...body, amountMinor: toMinor(amount) }, c.get("user").id);
  if (!created.ok) throw refusal(created.reason, "", body.productId);
  await logActivity(db, c.get("user"), ACTIONS.FINANCE_COST_ADDED, { type: "cost", id: created.cost.id, label: created.cost.name }, { category: body.category, charge: body.charge, amount, currency: body.currency, startsOn: body.startsOn });
  return c.json({ success: true, data: costView(created.cost) }, 201);
}

/** PUT /finance/costs/{id} */
export async function updateCost(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = valid<z.infer<typeof v.idParams>>(c, "param");
  const { amount, ...body } = valid<z.infer<typeof v.costUpdateSchema>>(c, "json");
  const before = await finance.getCost(db, id);
  if (!before) throw refusal("not_found", id);
  const updated = await finance.updateCost(db, id, { ...body, amountMinor: toMinor(amount) }, c.get("user").id, storeDayOf(new Date().toISOString()));
  if (!updated.ok) throw refusal(updated.reason, id, body.productId);
  await logActivity(db, c.get("user"), ACTIONS.FINANCE_COST_CHANGED, { type: "cost", id, label: updated.cost.name }, { before: costView(before), after: costView(updated.cost), changeFrom: body.changeFrom ?? null });
  return c.json({ success: true, data: costView(updated.cost) }, 200);
}

/** DELETE /finance/costs/{id} */
export async function deleteCost(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = valid<z.infer<typeof v.idParams>>(c, "param");
  const removed = await finance.deleteCost(db, id);
  if (!removed) throw refusal("not_found", id);
  await logActivity(db, c.get("user"), ACTIONS.FINANCE_COST_REMOVED, { type: "cost", id, label: removed.name });
  return c.json({ success: true, message: "Cost removed" }, 200);
}

/** GET /finance/costs/summary */
export async function costsSummary(c: Context<AppContext>) {
  const { from, to } = valid<z.infer<typeof v.summaryQuerySchema>>(c, "query");
  const value = await finance.costsSummary(getDb(c.env.DB), from, to);
  return c.json(
    {
      success: true,
      data: {
        from,
        to,
        total: fromMinor(value.centimes.total),
        ads: fromMinor(value.centimes.ads),
        running: fromMinor(value.centimes.running),
        perOrder: fromMinor(value.centimes.per_order),
        costs: value.costs.map((line) => ({ id: line.seriesId, amount: fromMinor(line.centimes), ownAmount: line.ownMinor === null ? null : fromMinor(line.ownMinor), ownCurrency: line.currency, orders: line.orders, missingFrom: line.missingFrom })),
        missing: value.missing.map(({ seriesIds, ...gap }) => ({ ...gap, costIds: seriesIds })),
      },
    },
    200,
  );
}

/** GET /finance/rates */
export async function listRates(c: Context<AppContext>) {
  return c.json({ success: true, data: (await finance.listRates(getDb(c.env.DB))).map(rateView) }, 200);
}

/** POST /finance/rates */
export async function setRate(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { dzdPerUnit, ...body } = valid<z.infer<typeof v.rateSchema>>(c, "json");
  const rate = await finance.setRate(db, { ...body, centimesPerUnit: toMinor(dzdPerUnit), createdBy: c.get("user").id });
  await logActivity(db, c.get("user"), ACTIONS.FINANCE_RATE_SET, { type: "exchange_rate", id: rate.id, label: rate.currency }, { currency: rate.currency, dzdPerUnit, validFrom: rate.validFrom });
  return c.json({ success: true, data: rateView(rate) }, 200);
}

/** DELETE /finance/rates/{id} */
export async function removeRate(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { id } = valid<z.infer<typeof v.idParams>>(c, "param");
  const removed = await finance.removeRate(db, id);
  if (!removed) throw new NotFoundError("Exchange rate", id);
  await logActivity(db, c.get("user"), ACTIONS.FINANCE_RATE_REMOVED, { type: "exchange_rate", id, label: removed.currency }, { currency: removed.currency, dzdPerUnit: fromMinor(removed.centimesPerUnit), validFrom: removed.validFrom });
  return c.json({ success: true, message: "Exchange rate removed" }, 200);
}
