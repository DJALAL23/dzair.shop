import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CustomerTagDetail } from "@/features/customer-tags/components/CustomerTagDetail";

function Gated({ tagId }: { tagId: string }) {
  return (
    <DashboardPage>
      <CustomerTagDetail tagId={tagId} />
    </DashboardPage>
  );
}

export default function CustomerTagDetailPageApp({ tagId }: { tagId: string }) {
  return (
    <RequireAuth>
      <Gated tagId={tagId} />
    </RequireAuth>
  );
}
