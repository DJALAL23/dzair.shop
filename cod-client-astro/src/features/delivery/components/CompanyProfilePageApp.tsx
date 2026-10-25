import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CompanyProfileDetail } from "@/features/delivery/components/CompanyProfileDetail";

function Gated({ providerCode }: { providerCode: string }) {
  return (
    <DashboardPage>
      <CompanyProfileDetail providerCode={providerCode} />
    </DashboardPage>
  );
}

export default function CompanyProfilePageApp({ providerCode }: { providerCode: string }) {
  return (
    <RequireAuth>
      <Gated providerCode={providerCode} />
    </RequireAuth>
  );
}
