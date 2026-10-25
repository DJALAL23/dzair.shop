import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { NewOrderForm } from "@/features/orders/components/NewOrderForm";

export default function NewOrderPageApp() {
  return (
    <RequireAuth>
      <DashboardPage>
        <NewOrderForm />
      </DashboardPage>
    </RequireAuth>
  );
}
