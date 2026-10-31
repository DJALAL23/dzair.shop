import { describe, expect, it } from "vitest";
import { landingImageOrderProblem } from "./landing-pages";

describe("a new order of a landing page's images", () => {
  it("is each of the page's images, once, and no other", () => {
    expect(landingImageOrderProblem(["a", "b", "c"], ["c", "a", "b"])).toBeNull();
    expect(landingImageOrderProblem([], [])).toBeNull();
  });

  it("is refused with a duplicate, an image of another page, or a missing image", () => {
    expect(landingImageOrderProblem(["a", "b"], ["a", "a"])).toEqual({ reason: "duplicate", received: 2 });
    expect(landingImageOrderProblem(["a", "b"], ["a", "z"])).toEqual({ reason: "foreign", imageId: "z" });
    expect(landingImageOrderProblem(["a", "b", "c"], ["b", "a"])).toEqual({ reason: "incomplete", expected: 3, received: 2 });
  });
});
