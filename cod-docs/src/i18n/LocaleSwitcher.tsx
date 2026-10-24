import { useEffect } from "react";
import { useNavigate } from "zudoku/router";
import {
  isTranslated,
  localizeHref,
  localeCodes,
  localeOf,
  stripLocale,
  type LocaleCode,
} from "./navigation";

const labels: Record<LocaleCode, string> = {
  en: "EN",
  fr: "FR",
  ar: "AR",
};

function hrefFor(pathname: string, locale: LocaleCode): string {
  const path = stripLocale(pathname);
  return locale === "en" ? path : `/${locale}${path === "/" ? "" : path}`;
}

export function LocaleSwitcher({ pathname }: { pathname: string }) {
  const active = localeOf(pathname);
  const translated = isTranslated(pathname);
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.documentElement;
    root.lang = active;
    root.dir = active === "ar" ? "rtl" : "ltr";
  }, [active]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.closest("[data-locale-switcher]")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      const alreadyLocalized =
        active !== "en" && (href === `/${active}` || href.startsWith(`/${active}/`));
      const localized = localizeHref(href, active) ?? (alreadyLocalized ? href : undefined);
      if (!localized) return;

      event.preventDefault();
      event.stopPropagation();
      navigate(localized);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, navigate]);

  useEffect(() => {
    if (active === "en") return;

    const rewrite = () => {
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
        if (anchor.closest("[data-locale-switcher]")) continue;
        if (anchor.hasAttribute("download")) continue;
        const href = anchor.getAttribute("href");
        if (!href) continue;
        const localized = localizeHref(href, active);
        if (localized) anchor.setAttribute("href", localized);
      }
    };

    rewrite();
    const observer = new MutationObserver(rewrite);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    return () => observer.disconnect();
  }, [active]);

  if (!translated) return null;

  return (
    <nav aria-label="Language" className="flex items-center gap-1 text-xs">
      {localeCodes.map((locale) => (
        <a
          key={locale}
          data-locale-switcher
          href={hrefFor(pathname, locale)}
          aria-current={locale === active ? "page" : undefined}
          className={
            locale === active
              ? "rounded px-1.5 py-1 font-semibold text-foreground"
              : "rounded px-1.5 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          {labels[locale]}
        </a>
      ))}
    </nav>
  );
}
