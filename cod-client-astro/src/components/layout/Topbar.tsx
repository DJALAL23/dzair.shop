import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronDown, LogOut, Menu, Moon, Search, Sun, UserRound } from "lucide-react";
import { useIdentity } from "@/features/auth/components/RequireAuth";
import { authClient } from "@/lib/auth/client";
import { notify } from "@/lib/notify";
import { LOCALES, type Locale } from "@/i18n/config";
import { switchLocale, useLocale, useT } from "@/i18n/react";
import { persistTheme } from "@/theme/config";
import { useTheme } from "@/theme/react";
import {
  DropdownItem,
  DropdownLink,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui";

function initialOf(text: string): string {
  return text.trim().charAt(0).toUpperCase() || "?";
}

/** Who is signed in, and everything about their session: profile, language, appearance, sign-out. */
export function AccountMenu({ align = "end" }: { align?: "start" | "end" }) {
  const identity = useIdentity();
  const tA = useT("auth");
  const tN = useT("navigation");
  const locale = useLocale();
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const name = identity?.user.name || identity?.user.email || "";
  const languages: Record<Locale, string> = {
    ar: tN("language.arabic"),
    en: tN("language.english"),
    fr: tN("language.french"),
  };

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        notify.error(tA("unexpected_error"));
        return;
      }
      notify.flashSuccess(tA("sign_out_success"));
      window.location.replace("/sign-in");
    } catch {
      notify.error(tA("unexpected_error"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu
      align={align}
      triggerLabel={tN("account.label")}
      triggerClassName="flex h-9 max-w-56 items-center gap-1.5 rounded-full bg-card ps-1 pe-2 text-foreground shadow-card transition-colors hover:bg-subtle aria-expanded:bg-subtle"
      menuClassName="w-64"
      trigger={
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
            {initialOf(name)}
          </span>
          <ChevronDown size={14} aria-hidden="true" className="text-muted-foreground" />
        </>
      }
    >
      <div className="px-2 pb-2 pt-1">
        <p className="truncate text-sm font-semibold text-foreground">{identity?.user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{identity?.user.email}</p>
      </div>
      <DropdownSeparator />
      <DropdownLink href="/profile">
        <UserRound aria-hidden="true" />
        {tN("account.profile")}
      </DropdownLink>
      <DropdownSeparator />
      <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">{tN("language.label")}</p>
      {LOCALES.map((code) => (
        <DropdownItem key={code} checked={code === locale} onClick={() => switchLocale(code)}>
          <span lang={code}>{languages[code]}</span>
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">{tN("theme.label")}</p>
      <DropdownItem checked={theme === "light"} onClick={() => persistTheme("light")}>
        <Sun aria-hidden="true" />
        {tN("theme.light")}
      </DropdownItem>
      <DropdownItem checked={theme === "dark"} onClick={() => persistTheme("dark")}>
        <Moon aria-hidden="true" />
        {tN("theme.dark")}
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem onClick={() => void signOut()} disabled={signingOut}>
        <LogOut aria-hidden="true" />
        {tN("account.sign_out")}
      </DropdownItem>
    </DropdownMenu>
  );
}

function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);
  return mac;
}

export function GlobalSearch({ large = false }: { large?: boolean }) {
  const tN = useT("navigation");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mac = useIsMac();
  useHotkeys(
    "mod+k",
    (event) => {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    { enableOnFormTags: true },
  );

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    window.location.assign(value ? `/orders?search=${encodeURIComponent(value)}` : "/orders");
  }

  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        aria-label={tN("navbar.search_placeholder")}
        placeholder={tN("navbar.search_placeholder")}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        className={`peer w-full rounded-full bg-card ps-9 text-sm text-foreground shadow-card outline-none transition-shadow duration-150 placeholder:text-subtle-foreground focus:shadow-[0_0_0_1px_var(--ring),0_0_0_4px_color-mix(in_srgb,var(--ring)_15%,transparent)] ${large ? "h-10 pe-3" : "h-9 pe-14"}`}
      />
      {!large && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md bg-muted px-1.5 py-px font-sans text-[11px] font-medium text-muted-foreground peer-focus:hidden"
        >
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      )}
    </form>
  );
}

export function DashboardTopbar({ onMenu }: { onMenu?: () => void }) {
  const tN = useT("navigation");
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-3 md:px-4">
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label={tN("menu.open")}
          className="grid size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06]"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
      )}
      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <div className="w-full max-w-md">
          <GlobalSearch />
        </div>
      </div>
      <div className="ms-auto flex shrink-0 items-center md:ms-0">
        <AccountMenu />
      </div>
    </header>
  );
}
