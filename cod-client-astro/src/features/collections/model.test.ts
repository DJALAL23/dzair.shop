import { describe, expect, it } from "vitest";
import { COLLECTION_MAX_PRODUCTS, addLast, collectionsErrorMessage, handleFromTitle, isValidHandle, move } from "./model";

const item = (id: string) => ({ id });

describe("handles", () => {
  it("come from the title, and only a valid one is accepted", () => {
    expect(handleFromTitle("Best sellers")).toBe("best-sellers");
    expect(handleFromTitle("Nouveautés d'été")).toBe("nouveautes-d-ete");
    expect(handleFromTitle("الأكثر مبيعاً")).toBe("collection");
    expect(isValidHandle("best-sellers")).toBe(true);
    for (const handle of ["Best", "-x", "a b", ""]) expect(isValidHandle(handle)).toBe(false);
  });
});

describe("ordering a collection", () => {
  it("moves a product one place, and leaves the ends alone", () => {
    const list = [item("a"), item("b"), item("c")];
    expect(move(list, 0, "down").map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(move(list, 2, "up").map((entry) => entry.id)).toEqual(["a", "c", "b"]);
    expect(move(list, 0, "up")).toEqual(list);
    expect(move(list, 2, "down")).toEqual(list);
    expect(list.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("adds a product at the end, once, and never past the limit", () => {
    expect(addLast([item("a")], item("b")).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(addLast([item("a")], item("a"))).toHaveLength(1);
    const full = Array.from({ length: COLLECTION_MAX_PRODUCTS }, (_, index) => item(`p${index}`));
    expect(addLast(full, item("extra"))).toHaveLength(COLLECTION_MAX_PRODUCTS);
  });
});

describe("collectionsErrorMessage", () => {
  const t = (key: string) => key;
  it("names what the merchant can fix, never the server's text", () => {
    const error = (code: string) => Object.assign(new Error("server text"), { name: "ApiError", code });
    expect(collectionsErrorMessage(error("DUPLICATE_COLLECTION_HANDLE"), t)).toBe("errors.handle_taken");
    expect(collectionsErrorMessage(error("COLLECTION_NOT_FOUND"), t)).toBe("errors.not_found");
    expect(collectionsErrorMessage(error("INVALID_COLLECTION_PRODUCTS"), t)).toBe("errors.validation");
    expect(collectionsErrorMessage(new Error("x"), t)).toBe("errors.generic");
  });
});
