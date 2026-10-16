import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

const DropdownCloseContext = createContext<() => void>(() => undefined);

export function DropdownMenu({
  trigger,
  triggerLabel,
  children,
  align = "end",
  triggerClassName,
  menuClassName = "",
}: {
  trigger: ReactNode;
  triggerLabel: string;
  children: ReactNode;
  align?: "start" | "end";
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  function close({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl";
    const alignRight = align === "end" ? !isRtl : isRtl;
    const preferredLeft = alignRight
      ? triggerRect.right - menuRect.width
      : triggerRect.left;
    const left = Math.max(
      8,
      Math.min(preferredLeft, window.innerWidth - menuRect.width - 8),
    );
    const preferredTop = triggerRect.bottom + 4;
    const top =
      preferredTop + menuRect.height <= window.innerHeight - 8
        ? preferredTop
        : Math.max(8, triggerRect.top - menuRect.height - 4);
    setPosition({ top, left });
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close({ restoreFocus: true });
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href][role="menuitem"]',
        ) ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(
        document.activeElement as HTMLElement,
      );
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    const onClick = (event: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      )
        close();
    };
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (
        menuRef.current &&
        target &&
        (menuRef.current === target || menuRef.current.contains(target))
      ) {
        return;
      }
      close();
    };
    const onResize = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          triggerClassName ??
          "grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground aria-expanded:bg-foreground/[0.08] aria-expanded:text-foreground pointer-coarse:size-10"
        }
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <DropdownCloseContext.Provider
            value={() => close({ restoreFocus: true })}
          >
            <div
              ref={menuRef}
              role="menu"
              aria-label={triggerLabel}
              style={position}
              className={`fixed z-[80] max-h-[min(28rem,calc(100dvh-5rem))] min-w-48 animate-pop overflow-y-auto overscroll-contain rounded-xl bg-popover p-1.5 shadow-popover ${menuClassName}`}
            >
              {children}
            </div>
          </DropdownCloseContext.Provider>,
          document.body,
        )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  disabled,
  danger,
  checked,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
}) {
  const close = useContext(DropdownCloseContext);
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => {
        if (!disabled) {
          onClick?.();
          close();
        }
      }}
      disabled={disabled}
      className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors disabled:opacity-40 select-none pointer-coarse:min-h-10 [&_svg]:size-4 [&_svg]:shrink-0 ${
        danger
          ? "text-destructive hover:bg-[var(--tone-critical-bg)] focus-visible:bg-[var(--tone-critical-bg)]"
          : "text-foreground hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06]"
      }`}
    >
      {children}
      {checked && <Check className="ms-auto" aria-hidden="true" />}
    </button>
  );
}

/** A quiet line between groups of menu items. */
export function DropdownSeparator() {
  return <div role="separator" className="-mx-1.5 my-1.5 h-px bg-border" />;
}

export function DropdownLink({
  children,
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const close = useContext(DropdownCloseContext);
  return (
    <a
      {...props}
      role="menuitem"
      tabIndex={-1}
      onClick={(event) => {
        props.onClick?.(event);
        close();
      }}
      className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm text-foreground transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] select-none pointer-coarse:min-h-10 [&_svg]:size-4 [&_svg]:shrink-0 ${className}`}
    >
      {children}
    </a>
  );
}
