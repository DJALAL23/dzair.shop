import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { OrderDetail } from "@/features/orders/components/OrderDetail";

export default function OrderDetailPageApp({ orderId }: { orderId: string }) {
  return (
    <RequireAuth>
      <DashboardPage>
        <OrderDetail orderId={orderId} />
      </DashboardPage>
    </RequireAuth>
  );
}
