import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { CustomerDetail } from "@/features/customers/components/CustomerDetail";

function Gated({ customerId }: { customerId: string }) {
  return (
    <DashboardPage>
      <CustomerDetail customerId={customerId} />
    </DashboardPage>
  );
}

export default function CustomerDetailPageApp({
  customerId,
}: {
  customerId: string;
}) {
  return (
    <RequireAuth>
      <Gated customerId={customerId} />
    </RequireAuth>
  );
}
