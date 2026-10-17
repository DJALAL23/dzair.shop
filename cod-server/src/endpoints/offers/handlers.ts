import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import type { CreateOfferInput, UpdateOfferInput } from "./validation";
import { ConflictError, NotFoundError, SystemError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import type { OfferWriteProblem } from "../../../../cod-shared/queries/offers";

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

/** A write the rules refused, as the error the merchant reads. */
export function offerWriteError(problem: OfferWriteProblem) {
  return problem.reason === "conflict"
    ? new ConflictError("Another live offer already applies to this product at that time", ERROR_CODES.OFFER_CONFLICT, { offerId: problem.offerId, offerName: problem.offerName })
    : new ValidationError("The offer is not coherent", ERROR_CODES.INVALID_OFFER, { reason: problem.reason });
}

export async function listOffers(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const data = await queries.listOffers(db);
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function getOffer(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const data = await queries.getOfferById(db, id);
  if (!data) throw new NotFoundError("Offer", id);
  return c.json({ success: true, data }, 200);
}

export async function createOffer(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const result = await queries.createOffer(db, body<CreateOfferInput>(c));
  if (!result.ok) throw offerWriteError(result);
  const data = await queries.getOfferById(db, result.id);
  if (!data) throw new SystemError("Failed to load created offer");
  return c.json({ success: true, data }, 201);
}

export async function updateOffer(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const result = await queries.updateOffer(db, id, body<UpdateOfferInput>(c));
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Offer", id);
  if (!result.ok) throw offerWriteError(result as OfferWriteProblem);
  const data = await queries.getOfferById(db, id);
  if (!data) throw new SystemError("Failed to load updated offer");
  return c.json({ success: true, data }, 200);
}

export async function deleteOffer(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const existing = await queries.getOfferById(db, id);
  if (!existing) throw new NotFoundError("Offer", id);
  await queries.deleteOffer(db, id);
  return c.json({ success: true }, 200);
}
