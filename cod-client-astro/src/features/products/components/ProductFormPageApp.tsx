import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { ProductForm } from "@/features/products/components/ProductForm";

function Gated({ productId }: { productId?: string }) {
  return (
    <DashboardPage>
      <ProductForm productId={productId} />
    </DashboardPage>
  );
}

export default function ProductFormPageApp({
  productId,
}: {
  productId?: string;
}) {
  return (
    <RequireAuth>
      <Gated productId={productId} />
    </RequireAuth>
  );
}
