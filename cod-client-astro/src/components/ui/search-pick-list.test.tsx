// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPickList } from "./search-pick-list";
import type { PickerOption } from "./search-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG: PickerOption[] = [
  { id: "p1", label: "Robe" },
  { id: "p2", label: "Sac" },
  { id: "p3", label: "Bague" },
];

let host: HTMLDivElement;
let root: Root;
let picked: PickerOption[] = [];

function Harness({ max }: { max?: number }) {
  const [value, setValue] = useState<PickerOption[]>([]);
  picked = value;
  return <SearchPickList value={value} onChange={setValue} search={async (q) => CATALOG.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))} placeholder="Search products" emptyLabel="Nothing" max={max} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const searchBox = () => host.querySelector<HTMLInputElement>('input[type="search"]');
const optionButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"] button'));

async function search(text: string) {
  const input = searchBox()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe("SearchPickList", () => {
  it("adds each pick to the list, empties the search for the next, and offers only what is not picked", async () => {
    act(() => root.render(<Harness />));
    await search("ro");
    act(() => optionButtons()[0]!.click());
    expect(picked.map((o) => o.id)).toEqual(["p1"]);
    expect(searchBox()!.value).toBe("");

    await search("");
    expect(optionButtons().map((b) => b.textContent)).toEqual(["Sac", "Bague"]);
  });

  it("takes a pick out again, and stops picking at the limit", async () => {
    act(() => root.render(<Harness max={2} />));
    await search("");
    act(() => optionButtons()[0]!.click());
    await search("");
    act(() => optionButtons()[0]!.click());
    expect(picked.map((o) => o.id)).toEqual(["p1", "p2"]);
    expect(searchBox()).toBeNull();

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label*="Robe"]')!.click());
    expect(picked.map((o) => o.id)).toEqual(["p2"]);
    expect(searchBox()).not.toBeNull();
  });
});
