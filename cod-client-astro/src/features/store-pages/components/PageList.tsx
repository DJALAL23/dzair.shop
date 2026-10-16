import { FilePlus, FileText, RotateCcw, Scale, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { orderStorePages, pageKindLabelKey, pageNeedsReview } from "@/features/store-pages/model";
import type { PageLocale, StorePageKind, StorePageSummary } from "@/features/store-pages/types";
import {
  Badge,
  Button,
  Card,
  CellEmpty,
  EmptyState,
  RowTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";

interface PageListProps {
  pages: StorePageSummary[];
  /** The store's languages: a page needs review while any of them is unwritten or still the template. */
  locales: readonly PageLocale[];
  onOpen: (id: string) => void;
  onSeedDefaults: () => void;
}

const KIND_ICONS: Record<StorePageKind, LucideIcon> = {
  terms: Scale,
  privacy: ShieldCheck,
  refund: RotateCcw,
  shipping: Truck,
  custom: FileText,
};

function PageIcon({ kind }: { kind: StorePageKind }) {
  const Icon = KIND_ICONS[kind] ?? FileText;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

/** Every storefront page: the four policies first, then the merchant's own. A row opens the page. */
export function PageList({ pages, locales, onOpen, onSeedDefaults }: PageListProps) {
  const t = useT("store-pages");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.STORE_PAGES_MANAGE);
  const ordered = orderStorePages(pages);

  if (ordered.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck />}
          title={t("list.empty_title")}
          description={t("list.empty_body")}
          action={
            canManage ? (
              <Button onClick={onSeedDefaults}>
                <FilePlus size={16} aria-hidden="true" />
                {t("list.seed_defaults")}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const title = (page: StorePageSummary) =>
    page.kind === "custom" ? page.translations[0]?.title || page.slug : t(pageKindLabelKey(page.kind));
  const review = (page: StorePageSummary) =>
    page.kind === "custom" ? null : pageNeedsReview(page, locales) ? (
      <Badge tone="warning">{t("list.needs_review")}</Badge>
    ) : (
      <Badge tone="success">{t("list.reviewed")}</Badge>
    );
  const visibility = (page: StorePageSummary) => (page.status === "published" ? t("list.status_published") : t("list.status_draft"));

  return (
    <Card flush>
      <ul className="divide-y divide-border md:hidden">
        {ordered.map((page) => (
          <li key={page.id}>
            <button type="button" onClick={() => onOpen(page.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-subtle">
              <PageIcon kind={page.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{title(page)}</span>
                <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                  /pages/{page.slug}
                </span>
              </span>
              {review(page) ?? <span className="text-xs text-muted-foreground">{visibility(page)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.col_page")}</TableHead>
              <TableHead>{t("list.col_link")}</TableHead>
              <TableHead>{t("list.col_review")}</TableHead>
              <TableHead>{t("list.col_visibility")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((page) => (
              <TableRow key={page.id} onClick={() => onOpen(page.id)} className="cursor-pointer">
                <TableCell className="max-w-72">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(page.id);
                    }}
                    className="w-full rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RowTitle media={<PageIcon kind={page.kind} />}>{title(page)}</RowTitle>
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span dir="ltr">/pages/{page.slug}</span>
                </TableCell>
                <TableCell>{review(page) ?? <CellEmpty />}</TableCell>
                <TableCell className="text-muted-foreground">{visibility(page)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
