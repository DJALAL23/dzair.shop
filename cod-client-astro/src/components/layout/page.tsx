import type { ReactNode } from "react";
import { useT } from "@/i18n/react";
import { Alert, ConfirmDialogProvider, ErrorBoundary } from "@/components/ui";

/** A dashboard page's content. The frame around it belongs to DashboardLayout and stays on screen between pages. */
export function DashboardPage({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const common = useT("common");
  return (
    <ConfirmDialogProvider>
      <div className={`mx-auto animate-rise px-4 pb-16 pt-5 sm:px-8 sm:pt-8 ${narrow ? "max-w-[784px]" : "max-w-[1144px]"}`}>
        {/* A page that fails to render shows this, inside the frame — never a blank screen. */}
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
    </ConfirmDialogProvider>
  );
}
