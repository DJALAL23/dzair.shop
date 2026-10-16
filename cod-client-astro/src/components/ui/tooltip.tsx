import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useT } from "@/i18n/react";

const GAP = 6;
const MARGIN = 8;

/**
 * A small ⓘ beside a label that holds the explanation a field would otherwise
 * print under itself. It opens on hover with a mouse, on keyboard focus, and
 * on tap on a touch screen; Escape, a tap elsewhere or leaving closes it. The
 * bubble is portalled and fixed, flipping above or below to stay on screen.
 */
export function InfoTip({ children, label }: { children: ReactNode; label?: string }) {
  const common = useT("common");
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const openedAt = useRef(0);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useEffect(() => {
    if (!open) setPlace(null);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!triggerRef.current || !tipRef.current) return;
      const anchor = triggerRef.current.getBoundingClientRect();
      const tip = tipRef.current.getBoundingClientRect();
      const below = anchor.top - tip.height - GAP < MARGIN;
      const left = Math.min(Math.max(anchor.left + anchor.width / 2 - tip.width / 2, MARGIN), window.innerWidth - tip.width - MARGIN);
      setPlace({ left, top: below ? anchor.bottom + GAP : anchor.top - tip.height - GAP, below });
    };
    measure();
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !tipRef.current?.contains(target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  function hover(next: boolean) {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (next) openedAt.current = Date.now();
      setOpen(next);
    }, next ? 120 : 80);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ?? common("more_info")}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // A tap focuses the button first; that focus already opened the tip.
          if (Date.now() - openedAt.current < 400) return;
          setOpen((current) => !current);
        }}
        onPointerEnter={(event) => event.pointerType === "mouse" && hover(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && hover(false)}
        onFocus={() => {
          openedAt.current = Date.now();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="relative inline-grid size-4 shrink-0 place-items-center rounded-full align-[-0.15em] text-subtle-foreground transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:text-foreground"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            onPointerEnter={() => window.clearTimeout(hoverTimer.current)}
            onPointerLeave={(event) => event.pointerType === "mouse" && hover(false)}
            style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
            className={`fixed z-[90] w-max max-w-[min(18rem,calc(100vw-1rem))] animate-pop rounded-lg bg-foreground px-3 py-2 text-start text-xs leading-relaxed font-normal text-background shadow-popover ${place ? "" : "invisible"}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
