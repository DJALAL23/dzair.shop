import { describe, expect, it } from "vitest";
import { isFramelessPath } from "./frame-path";

describe("routes without the dashboard frame", () => {
  it("are the root and the landing-page studio", () => {
    for (const path of ["/", "/landing-pages/lp_1/studio", "/landing-pages/lp_1/studio/"]) {
      expect(isFramelessPath(path), path).toBe(true);
    }
  });

  it("leave every other page, detail pages included, inside the frame", () => {
    for (const path of ["/dashboard", "/orders", "/orders/ord_1", "/orders/abandoned/", "/landing-pages", "/landing-pages/new", "/landing-pages/lp_1", "/landing-pages/lp_1/studio/x", "/customers/c_1/edit"]) {
      expect(isFramelessPath(path), path).toBe(false);
    }
  });
});
