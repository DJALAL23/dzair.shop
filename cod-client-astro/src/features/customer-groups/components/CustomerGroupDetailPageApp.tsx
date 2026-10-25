import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CustomerGroupDetail } from "@/features/customer-groups/components/CustomerGroupDetail";

function Gated({ groupId }: { groupId: string }) {
  return (
    <DashboardPage>
      <CustomerGroupDetail groupId={groupId} />
    </DashboardPage>
  );
}

export default function CustomerGroupDetailPageApp({
  groupId,
}: {
  groupId: string;
}) {
  return (
    <RequireAuth>
      <Gated groupId={groupId} />
    </RequireAuth>
  );
}
