import { Skeleton } from "@/components/ui/skeleton";

/**
 * The one loading state of a dashboard page: its header and a list, in the
 * place the page will take. Page shells render it statically (gate) and
 * RequireAuth renders the same markup while it checks (authState), so the
 * swap from one to the other shows nothing moving.
 */
export function PageSkeleton({ gate, authState }: { gate?: "required"; authState?: string }) {
  return (
    <div
      data-skeleton=""
      data-gate-spinner={gate}
      data-auth-state={authState}
      role="status"
      aria-busy="true"
      className="mx-auto max-w-[1144px] px-4 pb-16 pt-5 sm:px-8 sm:pt-8"
    >
      <div className="mb-6 flex min-h-9 items-center justify-between gap-4 border-b border-border pb-4">
        <Skeleton className="h-6 w-44 max-w-[50%]" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="h-8 w-full max-w-xs rounded-lg" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
