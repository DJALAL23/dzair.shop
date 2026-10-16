import { describe, expect, it } from "vitest";
import { buildReviewsUrl, formatDuration, formatReviewDate, parseReviewStatus, photosOf, readReviewView, reviewErrorMessage, voiceOf } from "./model";

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe("reviews model", () => {
  it("parses only valid review statuses", () => {
    expect(parseReviewStatus("pending")).toBe("pending");
    expect(parseReviewStatus("approved")).toBe("approved");
    expect(parseReviewStatus("rejected")).toBe("rejected");
    expect(parseReviewStatus("processing")).toBeUndefined();
    expect(parseReviewStatus("all")).toBeUndefined();
    expect(parseReviewStatus(undefined)).toBeUndefined();
  });

  it("keeps the list's filters in the address, and reads them back", () => {
    const all = { status: "all", source: "all", withMedia: false, page: 1 } as const;
    expect(buildReviewsUrl(all)).toBe("/reviews");
    expect(buildReviewsUrl({ ...all, status: "pending" })).toBe("/reviews?status=pending");
    const busy = { status: "approved", source: "merchant", withMedia: true, page: 2 } as const;
    expect(buildReviewsUrl(busy)).toBe("/reviews?status=approved&source=merchant&media=1&page=2");
    expect(readReviewView("?status=approved&source=merchant&media=1&page=2")).toEqual(busy);
    expect(readReviewView("?status=processing&source=ai&page=-3")).toEqual(all);
  });

  it("explains every refusal in the merchant's words", () => {
    expect(reviewErrorMessage({ code: "REVIEW_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(reviewErrorMessage({ code: "ORDER_ALREADY_REVIEWED" }, t)).toBe("error_already_reviewed");
    expect(reviewErrorMessage({ code: "PRODUCT_NOT_IN_ORDER" }, t)).toBe("error_not_in_order");
    expect(reviewErrorMessage({ code: "FILE_TOO_LARGE" }, t)).toBe("error_file_too_large");
    expect(reviewErrorMessage({ code: "INVALID_FILE_TYPE" }, t)).toBe("error_file_type");
    expect(reviewErrorMessage({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "image", max: 6 } }, t)).toBe('error_too_many_photos:{"count":6}');
    expect(reviewErrorMessage({ code: "REVIEW_MEDIA_LIMIT", context: { kind: "audio", max: 1 } }, t)).toBe("error_one_voice");
    expect(reviewErrorMessage({ code: "REVIEW_UPLOAD_NOT_FOUND" }, t)).toBe("error_upload_missing");
    expect(reviewErrorMessage({ code: "VALIDATION_FAILED", context: { field: "body", min: 10 } }, t)).toBe('error_body_short:{"count":10}');
    expect(reviewErrorMessage({ code: "REQUIRED_FIELD_MISSING", context: { field: "customerName" } }, t)).toBe("error_customer_required");
    expect(reviewErrorMessage(new Error("boom"), t)).toBe("error_generic");
  });

  it("formats dates and voice-note lengths", () => {
    expect(formatReviewDate("2026-08-26T00:00:00.000Z", "en")).toBe("August 26, 2026");
    expect(formatReviewDate("not-a-date", "en")).toBe("-");
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(90_000)).toBe("1:30");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });

  it("tells a review's photos from its voice note", () => {
    const media = [
      { id: "a", kind: "audio" },
      { id: "p1", kind: "image" },
      { id: "p2", kind: "image" },
    ] as never;
    expect(photosOf({ media }).map((m) => m.id)).toEqual(["p1", "p2"]);
    expect(voiceOf({ media })?.id).toBe("a");
    expect(voiceOf({ media: [] })).toBeNull();
  });
});
