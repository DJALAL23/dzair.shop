import { Card } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { CollectionSummary } from "@/features/collections/types";

/** The curated lists a product is in, ticked from its own page. */
export function ProductCollectionsCard({
  collections,
  selected,
  onChange,
  busy,
}: {
  collections: CollectionSummary[];
  selected: string[];
  onChange: (ids: string[]) => void;
  busy: boolean;
}) {
  const t = useT("collections");
  return (
    <Card title={t("product_card.title")} subtitle={t("product_card.hint")}>
      {collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("product_card.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {collections.map((collection) => {
            const checked = selected.includes(collection.id);
            return (
              <li key={collection.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-foreground hover:bg-foreground/[0.04]">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={checked}
                    disabled={busy}
                    onChange={() => onChange(checked ? selected.filter((id) => id !== collection.id) : [...selected, collection.id])}
                  />
                  <span className="flex-1 truncate">{collection.title}</span>
                  <code dir="ltr" className="text-[11px] text-muted-foreground">{collection.handle}</code>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
