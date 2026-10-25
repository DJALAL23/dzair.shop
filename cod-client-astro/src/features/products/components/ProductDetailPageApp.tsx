import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { ProductDetail } from "@/features/products/components/ProductDetail";

function Gated({ productId }: { productId: string }) {
  return (
    <DashboardPage>
      <ProductDetail productId={productId} />
    </DashboardPage>
  );
}

export default function ProductDetailPageApp({
  productId,
}: {
  productId: string;
}) {
  return (
    <RequireAuth>
      <Gated productId={productId} />
    </RequireAuth>
  );
}
