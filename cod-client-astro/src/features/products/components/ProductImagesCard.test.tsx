// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ProductImage } from "@/features/products/types";
import { ProductImagesCard } from "./ProductImagesCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const image = (id: string, position: number): ProductImage => ({
  id,
  productId: "prod-1",
  src: `https://cdn.test/${id}.webp`,
  type: 1,
  position,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

it("numbers the images by their place, whatever positions earlier removals left", () => {
  act(() => root.render(<ProductImagesCard productName="Kaftan" images={[image("b", 2), image("c", 5)]} />));

  const labels = Array.from(host.querySelectorAll(".aspect-square span.bottom-2")).map((span) => span.textContent);
  expect(labels).toEqual(["#1", "#2"]);
});
