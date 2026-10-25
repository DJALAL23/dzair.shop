import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CompanyStopDesksDetail } from "@/features/delivery/components/CompanyStopDesksDetail";

function Gated({ providerCode }: { providerCode: string }) {
  return (
    <DashboardPage>
      <CompanyStopDesksDetail providerCode={providerCode} />
    </DashboardPage>
  );
}

export default function CompanyStopDesksPageApp({ providerCode }: { providerCode: string }) {
  return (
    <RequireAuth>
      <Gated providerCode={providerCode} />
    </RequireAuth>
  );
}
