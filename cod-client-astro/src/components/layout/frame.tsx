import { useEffect, useState } from "react";
import { SignedIn } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { DashboardSidebar } from "@/components/layout/Sidebar";
import { DashboardTopbar } from "@/components/layout/Topbar";
import { MobileChrome } from "@/components/layout/MobileChrome";
import { isFramelessPath } from "@/components/layout/frame-path";

/** The current path. The frame survives navigation and keeps its first props, so it follows the router instead. */
export function useFramePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    document.addEventListener("astro:after-swap", sync);
    return () => document.removeEventListener("astro:after-swap", sync);
  }, []);
  return path;
}

export function FrameSidebar() {
  const path = useFramePath();
  const tN = useT("navigation");
  if (isFramelessPath(path)) return null;
  return (
    <SignedIn>
      <a
        href="#dashboard-main"
        className="fixed start-3 top-3 z-[80] -translate-y-20 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-popover transition-transform focus:translate-y-0"
      >
        {tN("skip_to_content")}
      </a>
      <DashboardSidebar currentPath={path} />
    </SignedIn>
  );
}

export function FrameTopbar() {
  const path = useFramePath();
  if (isFramelessPath(path)) return null;
  return (
    <SignedIn>
      <div className="hidden md:block">
        <DashboardTopbar />
      </div>
      <div className="md:hidden">
        <MobileChrome currentPath={path} />
      </div>
    </SignedIn>
  );
}
