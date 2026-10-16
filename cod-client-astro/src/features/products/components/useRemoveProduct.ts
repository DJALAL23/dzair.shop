import { useT } from "@/i18n/react";
import { useConfirmDialog } from "@/components/ui";
import { deleteProduct, getProductRemoval } from "@/features/products/api";
import { productErrorMessage, productRemovalConsequences } from "@/features/products/model";

/**
 * Removing a product, the same from the list and from its page: the server
 * says what goes and what stays, the merchant types the name to confirm, then
 * it is gone. Resolves true once removed, false when the merchant stopped;
 * a failure is reported through `onError`.
 */
export function useRemoveProduct(onError: (message: string) => void) {
  const t = useT("products");
  const common = useT("common");
  const confirm = useConfirmDialog();

  return async function remove(product: { id: string; name: string }): Promise<boolean> {
    try {
      const removal = await getProductRemoval(product.id);
      const accepted = await confirm({
        title: t("removal.title", { name: removal.name }),
        description: t("removal.description"),
        consequences: productRemovalConsequences(removal, t),
        confirmText: removal.name,
        confirmLabel: common("delete"),
        tone: "danger",
      });
      if (!accepted) return false;
      await deleteProduct(product.id);
      return true;
    } catch (cause) {
      onError(productErrorMessage(cause, t));
      return false;
    }
  };
}
