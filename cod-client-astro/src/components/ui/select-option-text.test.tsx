// @vitest-environment happy-dom
/**
 * An option written in several parts — `{name} {version}` — reads as the
 * words React would render, never as a comma list of its parts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Select } from "./select";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a select option's words", () => {
  it("join an option's text parts as React renders them", () => {
    const name = "Classic";
    const version = "1.4.0";
    act(() =>
      root.render(
        <Select aria-label="Theme" value="b" onChange={() => {}}>
          <option value="a">Pick one…</option>
          <option value="b">
            {name} {version} ({"current"})
          </option>
          <option value="c">{3} items</option>
        </Select>,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    expect(trigger.textContent).toContain("Classic 1.4.0 (current)");
    expect(trigger.textContent).not.toContain(",");
    const native = [...host.querySelectorAll("option")].map((option) => option.textContent);
    expect(native).toEqual(["Pick one…", "Classic 1.4.0 (current)", "3 items"]);
  });

  it("read the words inside an element, never an empty option", () => {
    act(() =>
      root.render(
        <Select aria-label="Wilaya" value="16" onChange={() => {}}>
          <option value="">Choose…</option>
          <option value="16">
            <span>
              {"16"} — {"الجزائر"} · <b>{"Alger"}</b>
            </span>
          </option>
        </Select>,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    expect(trigger.textContent).toContain("16 — الجزائر · Alger");
  });
});
