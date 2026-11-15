// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SortHeader } from "./SortHeader";

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

const header = (wrap?: boolean) => {
  act(() =>
    root.render(
      <table>
        <thead>
          <tr>
            <SortHeader label="Calls before cancelling" sortKey="calls" activeKey="name" direction="desc" onSort={() => {}} align="end" wrap={wrap} />
          </tr>
        </thead>
      </table>,
    ),
  );
  const cell = host.querySelector("th")!;
  return { cell: cell.className.split(/\s+/), label: cell.querySelector("button span")!.className.split(/\s+/) };
};

it("keeps a label on one line unless it may wrap, then on two balanced lines", () => {
  expect(header().cell).toContain("whitespace-nowrap");
  expect(header().cell).not.toContain("whitespace-normal");
  const wrapped = header(true);
  expect(wrapped.cell).toContain("whitespace-normal");
  expect(wrapped.cell).not.toContain("whitespace-nowrap");
  expect(wrapped.label).toEqual(expect.arrayContaining(["max-w-24", "text-balance"]));
});
