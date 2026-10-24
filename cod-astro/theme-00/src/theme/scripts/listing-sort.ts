/**
 * A listing's order control: a choice loads the listing in that order, from
 * its first page, with no empty field in its address.
 */
import { navigate } from "astro:transitions/client";
import { bindEach } from "@wocart/theme/lifecycle";

bindEach<HTMLFormElement>("[data-listing-sort]", (form) => {
  const onChange = () => {
    const url = new URL(form.action);
    for (const [name, value] of new FormData(form)) if (typeof value === "string" && value !== "") url.searchParams.set(name, value);
    void navigate(`${url.pathname}${url.search}`);
  };
  form.addEventListener("change", onChange);
  return () => form.removeEventListener("change", onChange);
});
