import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useIdentity } from "@/features/auth/components/RequireAuth";
import { cachedStoreSummary, readStoreSummary, watchStoreSummary, type StoreSummary } from "@/features/settings/store-summary";
import { useT } from "@/i18n/react";
import { NewBadge } from "@/components/ui/new-badge";
import {
  isCurrentPath,
  useNavSections,
  type NavGroup,
  type NavNode,
} from "@/components/layout/nav";

/** The store everyone on the team works in, and a way to open its storefront. Its settings open for admins. */
function StoreBlock() {
  const identity = useIdentity();
  const [store, setStore] = useState<StoreSummary | null>(() => cachedStoreSummary());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    readStoreSummary().then(
      (summary) => {
        if (alive) setStore(summary);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    const stop = watchStoreSummary(setStore);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!store) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 px-4 pb-4 pt-6" aria-hidden="true">
        <span className={`size-12 rounded-2xl ${failed ? "" : "shimmer"}`} />
        <span className={`h-5 w-24 rounded-md ${failed ? "" : "shimmer"}`} />
      </div>
    );
  }

  const words = store.name.split(/\s+/).filter(Boolean);
  const latin = /^[A-Za-z]/.test(store.name.trim());
  const initials = (latin ? words.slice(0, 2) : words.slice(0, 1)).map((word) => word.charAt(0).toUpperCase()).join("");
  const mark = store.logo ? (
    <img src={store.logo.url} alt="" className="size-12 rounded-2xl bg-card object-contain shadow-card" />
  ) : (
    <span className="grid size-12 place-items-center rounded-2xl bg-[var(--tone-magic-bg)] text-base font-semibold text-[var(--tone-magic-text)] shadow-[inset_0_0_0_1px_var(--tone-magic-border)]">
      {initials || "·"}
    </span>
  );

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 px-4 pb-4 pt-6 text-center">
      {identity?.role === "admin" ? (
        <a href="/settings" className="rounded-2xl" aria-label={store.name}>
          {mark}
        </a>
      ) : (
        mark
      )}
      <p className="max-w-full truncate text-sm font-semibold text-foreground">{store.name}</p>
      {store.domain && (
        <a
          href={`https://${store.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium text-foreground shadow-card transition-colors hover:bg-subtle"
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--chart-delivered)]" />
          <span dir="ltr" className="truncate">{store.domain}</span>
        </a>
      )}
    </div>
  );
}

const ROW =
  "group flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-[background-color,color,box-shadow] duration-150 pointer-coarse:h-10";
const ROW_ACTIVE = "bg-sidebar-active font-medium text-foreground shadow-[0_0_0_1px_var(--sidebar-border),0_1px_2px_0_rgb(0_0_0/0.05)]";
const ROW_IDLE = "text-foreground/75 hover:bg-foreground/[0.045] hover:text-foreground";

function NavIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={`shrink-0 transition-colors ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
    />
  );
}

function groupContainsCurrent(item: NavGroup, currentPath: string): boolean {
  return (
    (!!item.href && isCurrentPath(currentPath, item.href)) ||
    item.children.some((child) => isCurrentPath(currentPath, child.href))
  );
}

function NavGroupItem({ item, currentPath, onNavigate }: { item: NavGroup; currentPath: string; onNavigate?: () => void }) {
  const tN = useT("navigation");
  const within = groupContainsCurrent(item, currentPath);
  const [open, setOpen] = useState(within);
  const [openedAt, setOpenedAt] = useState(currentPath);
  if (openedAt !== currentPath) {
    setOpenedAt(currentPath);
    setOpen(within);
  }
  const href = item.href ?? item.children[0]?.href ?? "/";
  const current = isCurrentPath(currentPath, href);
  const hasChildren = item.children.length > 0;

  return (
    <li>
      <div className={`${ROW} pe-1 ${current ? ROW_ACTIVE : ROW_IDLE}`}>
        <a href={href} onClick={onNavigate} aria-current={current ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch">
          <NavIcon icon={item.icon} active={current || within} />
          <span className="truncate">{item.label}</span>
        </a>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`${open ? tN("menu.collapse_group") : tN("menu.expand_group")}: ${item.label}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {hasChildren && open && (
        <ul className="ms-[17px] mt-0.5 animate-fade">
          {item.children.map((child, index) => {
            const active = isCurrentPath(currentPath, child.href);
            const last = index === item.children.length - 1;
            return (
              <li key={child.href} className="relative ps-3.5">
                {!last && <span aria-hidden="true" className="absolute inset-y-0 start-0 border-s border-sidebar-border" />}
                <span aria-hidden="true" className="absolute start-0 top-0 h-1/2 w-2.5 rounded-es-md border-b border-s border-sidebar-border" />
                <a
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`${ROW} my-px ${active ? ROW_ACTIVE : ROW_IDLE}`}
                >
                  <span className="truncate">{child.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function NavItem({ item, currentPath, onNavigate }: { item: NavNode; currentPath: string; onNavigate?: () => void }) {
  if (item.kind === "group") return <NavGroupItem item={item} currentPath={currentPath} onNavigate={onNavigate} />;
  const active = isCurrentPath(currentPath, item.href);
  return (
    <li>
      <a href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}>
        <NavIcon icon={item.icon} active={active} />
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <span className="ms-auto">
            <NewBadge label={item.badge} />
          </span>
        )}
      </a>
    </li>
  );
}

/** The store's navigation: daily work first, the online store after, administration last. */
export function SidebarNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  const sections = useNavSections();
  const tN = useT("navigation");
  return (
    <nav aria-label={tN("sidebar.general")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      {sections.map((section, index) => (
        <section key={section.id} className={index > 0 ? "mt-3 border-t border-sidebar-border pt-3" : ""}>
          {section.label && <h2 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground select-none">{section.label}</h2>}
          <ul className="space-y-px">
            {section.items.map((item) => (
              <NavItem key={item.kind === "leaf" ? item.href : item.id} item={item} currentPath={currentPath} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return (
    <>
      <StoreBlock />
      <SidebarNav currentPath={currentPath} onNavigate={onNavigate} />
    </>
  );
}

export function DashboardSidebar({ currentPath }: { currentPath: string }) {
  return (
    <aside className="hidden min-h-0 w-60 flex-1 flex-col bg-sidebar md:flex">
      <SidebarContent currentPath={currentPath} />
    </aside>
  );
}
