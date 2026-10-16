import type { ReactNode } from "react";
import { useT } from "@/i18n/react";
import { Alert, ConfirmDialogProvider, ErrorBoundary } from "@/components/ui";
import { DashboardSidebar } from "@/components/layout/Sidebar";
import { DashboardTopbar } from "@/components/layout/Topbar";
import { MobileChrome } from "@/components/layout/MobileChrome";

export function DashboardChrome({
  currentPath,
  children,
  narrow = false,
}: {
  currentPath: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  const tN = useT("navigation");
  const common = useT("common");
  return (
    <ConfirmDialogProvider>
      <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
        <a
          href="#dashboard-main"
          className="fixed start-3 top-3 z-[80] -translate-y-20 rounded-lg bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-popover transition-transform focus:translate-y-0"
        >
          {tN("skip_to_content")}
        </a>
        <DashboardSidebar currentPath={currentPath} />
        <div className="flex min-w-0 flex-1 flex-col md:pe-2 md:pb-2">
          <div className="hidden md:block">
            <DashboardTopbar />
          </div>
          <div className="md:hidden">
            <MobileChrome currentPath={currentPath} />
          </div>
          <main
            id="dashboard-main"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-card outline-none md:rounded-2xl md:border md:border-border"
          >
            <div className={`mx-auto animate-rise px-4 pb-16 pt-5 sm:px-8 sm:pt-8 ${narrow ? "max-w-[784px]" : "max-w-[1144px]"}`}>
              {/* A page that fails to render shows this, inside the chrome — never a blank screen. */}
              <ErrorBoundary
                fallback={
                  <Alert role="alert" tone="critical">
                    <div className="flex-1">
                      <p className="font-semibold">{common("load_failed")}</p>
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-2 text-xs font-semibold underline underline-offset-4"
                      >
                        {common("reload_page")}
                      </button>
                    </div>
                  </Alert>
                }
              >
                {children}
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </ConfirmDialogProvider>
  );
}

