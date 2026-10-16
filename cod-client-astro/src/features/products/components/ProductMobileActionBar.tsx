import { ArrowLeft, History, Pencil, Trash2 } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button, LinkButton } from "@/components/ui";

/** On a phone: the product's actions within thumb's reach, where the header's would scroll away. */
export function ProductMobileActionBar({
  editHref,
  canManage,
  onHistory,
  onDelete,
}: {
  editHref: string;
  canManage: boolean;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const t = useT("products");
  const icon = "grid size-11 shrink-0 place-items-center rounded-lg shadow-card";
  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex gap-2 rounded-xl bg-card p-2 shadow-popover lg:hidden">
      <a href="/products" aria-label={t("page_title")} className={`${icon} text-muted-foreground`}>
        <ArrowLeft size={18} className="rtl:rotate-180" />
      </a>
      <button type="button" aria-label={t("actions.stock_history")} onClick={onHistory} className={`${icon} text-muted-foreground`}>
        <History size={18} />
      </button>
      {canManage && (
        <>
          <button type="button" aria-label={t("actions.delete")} onClick={onDelete} className={`${icon} text-destructive`}>
            <Trash2 size={18} />
          </button>
          <LinkButton href={editHref} className="h-11 flex-1">
            <Pencil size={16} />
            {t("actions.edit")}
          </LinkButton>
        </>
      )}
    </div>
  );
}
