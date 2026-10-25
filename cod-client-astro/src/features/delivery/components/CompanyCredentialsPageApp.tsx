import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CompanyCredentialsDetail } from "@/features/delivery/components/CompanyCredentialsDetail";

function Gated({ providerCode }: { providerCode: string }) {
  return (
    <DashboardPage>
      <CompanyCredentialsDetail providerCode={providerCode} />
    </DashboardPage>
  );
}

export default function CompanyCredentialsPageApp({ providerCode }: { providerCode: string }) {
  return (
    <RequireAuth>
      <Gated providerCode={providerCode} />
    </RequireAuth>
  );
}
