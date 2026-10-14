/**
 * Carrier failures as API errors — one mapping, used by every route that
 * talks to a carrier, so the dashboard can react to each kind the same way
 * everywhere (reconnect, wait, retry later, resolve by hand).
 */

import { ERROR_CATEGORIES, ERROR_CODES, type ErrorCode } from "../../../cod-shared/errors/codes";
import { AppError, BusinessLogicError, type ErrorContext } from "@/lib/errors/classes";
import { CarrierError, type CarrierErrorKind } from "./contract";

const MAPPING: Record<CarrierErrorKind, { code: ErrorCode; status: number; category: (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES] }> = {
  rejected: { code: ERROR_CODES.CARRIER_REJECTED, status: 422, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  // Our user is signed in; the carrier refused the company's credentials.
  auth: { code: ERROR_CODES.CARRIER_AUTH_FAILED, status: 409, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
  rate_limited: { code: ERROR_CODES.CARRIER_RATE_LIMITED, status: 429, category: ERROR_CATEGORIES.SYSTEM },
  unavailable: { code: ERROR_CODES.CARRIER_UNAVAILABLE, status: 502, category: ERROR_CATEGORIES.SYSTEM },
  ambiguous: { code: ERROR_CODES.CARRIER_OUTCOME_UNKNOWN, status: 502, category: ERROR_CATEGORIES.SYSTEM },
  misconfigured: { code: ERROR_CODES.CARRIER_MISCONFIGURED, status: 409, category: ERROR_CATEGORIES.BUSINESS_LOGIC },
};

export class CarrierRequestError extends AppError {
  constructor(error: CarrierError, context: ErrorContext = {}) {
    const { code, status, category } = MAPPING[error.kind];
    super(error.message, code, category, status, {
      ...context,
      provider: error.provider,
      kind: error.kind,
      ...(error.carrierCode ? { carrierCode: error.carrierCode } : {}),
      ...(error.httpStatus ? { carrierHttpStatus: error.httpStatus } : {}),
      ...(error.retryAfterSec != null ? { retryAfterSec: error.retryAfterSec } : {}),
    });
  }
}

/** Run a carrier call; a `CarrierError` leaves as the matching API error, anything else unchanged. */
export async function callCarrier<T>(context: ErrorContext, call: () => Promise<T> | T): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CarrierError) throw new CarrierRequestError(error, context);
    throw error;
  }
}

/** Refuse an operation this carrier does not offer, before any call is made. */
export function requireCapability(enabled: boolean, operation: string, context: ErrorContext): void {
  if (!enabled) {
    throw new BusinessLogicError(`This carrier does not support ${operation}`, ERROR_CODES.OPERATION_NOT_SUPPORTED, context);
  }
}
