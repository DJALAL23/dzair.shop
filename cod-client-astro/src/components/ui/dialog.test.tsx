// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Dialog } from "./dialog";

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
  document.body.innerHTML = "";
});

const widthOf = (className?: string) => {
  act(() => root.render(<Dialog open onClose={() => {}} title="Title" className={className}>body</Dialog>));
  return document.querySelector('[role="dialog"]')!.className.match(/(?:^|\s)(max-w-\S+)/g)?.map((name) => name.trim());
};

it("is the default width unless the dialog asks for its own, which then is the only one", () => {
  expect(widthOf()).toEqual(["max-w-lg"]);
  expect(widthOf("max-w-2xl")).toEqual(["max-w-2xl"]);
  expect(widthOf("max-w-sm text-sm")).toEqual(["max-w-sm"]);
});
