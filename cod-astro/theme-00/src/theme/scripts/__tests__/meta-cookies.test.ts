import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindMetaCookies, readCookie } from "../meta-cookies";

function orderForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form method="POST" id="f">
      <input type="hidden" name="fbc" id="fbc-input" value="" />
      <input type="hidden" name="fbp" id="fbp-input" value="" />
    </form>`;
  return document.getElementById("f") as HTMLFormElement;
}

function setCookies(value: string) {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  for (const part of value.split(";")) if (part.trim()) document.cookie = `${part.trim()}; path=/`;
}

describe("readCookie", () => {
  beforeEach(() => setCookies("_fbc_old=stale; _fbc=fb.1.1709136167115.IwAR2F4; other=1"));
  afterEach(() => setCookies(""));

  it("reads a cookie by its exact name", () => {
    expect(readCookie("_fbc")).toBe("fb.1.1709136167115.IwAR2F4");
  });

  it("answers null for an absent cookie", () => {
    expect(readCookie("_fbp")).toBeNull();
  });

  it("answers null for a cookie with no value", () => {
    document.cookie = "_fbp=; path=/";
    expect(readCookie("_fbp")).toBeNull();
  });
});

describe("bindMetaCookies", () => {
  beforeEach(() => setCookies("_fbc=fb.1.1709136167115.IwAR2F4; _fbp=fb.1.1596403881668.1116446470"));
  afterEach(() => setCookies(""));

  it("fills both hidden inputs when the form is submitted", () => {
    const form = orderForm();
    bindMetaCookies(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect((document.getElementById("fbc-input") as HTMLInputElement).value).toBe("fb.1.1709136167115.IwAR2F4");
    expect((document.getElementById("fbp-input") as HTMLInputElement).value).toBe("fb.1.1596403881668.1116446470");
  });

  it("reads at submit, so a cookie set after binding still travels", () => {
    const form = orderForm();
    setCookies("");
    bindMetaCookies(form);
    document.cookie = "_fbc=fb.1.1709136167115.Later; path=/";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect((document.getElementById("fbc-input") as HTMLInputElement).value).toBe("fb.1.1709136167115.Later");
  });

  it("leaves the inputs empty when there are no cookies, without failing the submit", () => {
    setCookies("");
    const form = orderForm();
    bindMetaCookies(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect((document.getElementById("fbc-input") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("fbp-input") as HTMLInputElement).value).toBe("");
  });

  it("clears a value a cookie no longer backs when the form is sent again", () => {
    const form = orderForm();
    bindMetaCookies(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    setCookies("");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect((document.getElementById("fbc-input") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("fbp-input") as HTMLInputElement).value).toBe("");
  });

  it("stops filling once its signal is aborted", () => {
    const form = orderForm();
    const controller = new AbortController();
    bindMetaCookies(form, controller.signal);
    controller.abort();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect((document.getElementById("fbc-input") as HTMLInputElement).value).toBe("");
  });
});
