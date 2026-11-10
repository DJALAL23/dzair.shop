import { Package, Pencil, Trash2 } from "lucide-react";
import { Badge, CellEmpty, IconButton, RowActions, RowTitle, TableCell, TableRow, openRowOnClick } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { formatMoneyValue, needsSku, productStockTone } from "@/features/products/model";
import type { Product, ProductCategory } from "@/features/products/types";

/** One status per product: what a shopper can do with it right now. */
export function ProductStatusBadge({ product }: { product: Product }) {
  const t = useT("products");
  if (product.status === "ARCHIVED") return <Badge tone="critical">{t("status_options.archived")}</Badge>;
  if (product.status === "DRAFT") return <Badge tone="neutral">{t("status_options.draft")}</Badge>;
  if (needsSku(product)) return <Badge tone="critical">{t("status.no_sku")}</Badge>;
  if (product.showInStore === false) return <Badge tone="neutral">{t("status.hidden_from_store")}</Badge>;
  return <Badge tone="success">{t("status_options.active")}</Badge>;
}

function StockValue({ product, counted = false }: { product: Product; counted?: boolean }) {
  const t = useT("products");
  const tone = productStockTone(product);
  const count = product.totalInventory ?? product.inventory ?? 0;
  if (tone === "none") return counted ? null : <span className="text-muted-foreground">∞</span>;
  if (tone === "out") return <span className="text-[var(--tone-critical-text)]">{t("status.out_of_stock")}</span>;
  return <>{counted ? t("in_stock_count", { count }) : count}</>;
}

function Thumbnail({ product, size }: { product: Product; size: "sm" | "md" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted shadow-card ${size === "sm" ? "size-9" : "size-11"}`}
    >
      {product.primaryImage ? (
        <img src={product.primaryImage.url} alt="" className="size-full object-cover" />
      ) : (
        <Package size={size === "sm" ? 15 : 18} aria-hidden="true" className="text-subtle-foreground" />
      )}
    </span>
  );
}

interface RowProps {
  product: Product;
  categoryMap: Map<string, ProductCategory>;
  canManage: boolean;
  onDelete: (product: Product) => void;
}

function productHref(product: Product) {
  return `/products/${encodeURIComponent(product.id)}`;
}

export function ProductDesktopRow({ product, categoryMap, canManage, onDelete }: RowProps) {
  const t = useT("products");
  const locale = useLocale();
  const category = product.categoryId ? categoryMap.get(product.categoryId) : undefined;
  return (
    <TableRow onClick={openRowOnClick(productHref(product))} className="cursor-pointer">
      <TableCell className="max-w-80">
        <RowTitle href={productHref(product)} media={<Thumbnail product={product} size="sm" />}>
          {product.name}
        </RowTitle>
      </TableCell>
      <TableCell>
        <ProductStatusBadge product={product} />
      </TableCell>
      <TableCell className="max-w-44 truncate text-muted-foreground">{category?.name ?? <CellEmpty />}</TableCell>
      <TableCell numeric>
        <StockValue product={product} />
      </TableCell>
      <TableCell numeric>{formatMoneyValue(product.price, locale)}</TableCell>
      <TableCell className="w-px">
        {canManage && (
          <RowActions>
            <a
              href={`${productHref(product)}/edit`}
              aria-label={t("actions.edit")}
              title={t("actions.edit")}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Pencil size={15} aria-hidden="true" />
            </a>
            <IconButton
              type="button"
              aria-label={t("actions.delete")}
              title={t("actions.delete")}
              variant="danger"
              onClick={() => onDelete(product)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </IconButton>
          </RowActions>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ProductMobileCard({ product }: Pick<RowProps, "product">) {
  const locale = useLocale();
  return (
    <a href={productHref(product)} className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-subtle">
      <Thumbnail product={product} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{product.name}</span>
        <span className="mt-1 block">
          <ProductStatusBadge product={product} />
        </span>
      </span>
      <span className="shrink-0 text-end">
        <span className="block text-sm font-medium tabular-nums text-foreground">{formatMoneyValue(product.price, locale)}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">
          <StockValue product={product} counted />
        </span>
      </span>
    </a>
  );
}
