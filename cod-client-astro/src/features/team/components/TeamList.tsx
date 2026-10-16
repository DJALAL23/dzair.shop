import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { UserPlus, Users, X } from "lucide-react";
import { useIdentity } from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Button,
  PageHeader,
  TableSkeleton,
  Card,
  EmptyState,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  SortHeader,
  useConfirmDialog,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import {
  filterTeamMembers,
  paginateTeamMembers,
  sortTeamMembers,
  teamErrorMessage,
  type TeamFilters,
  type TeamSortKey,
} from "@/features/team/model";
import { listAllTeamMembers, rotateTeamMemberApiKey } from "@/features/team/api";
import type { TeamMember } from "@/features/team/types";
import { InviteDialog } from "@/features/team/components/InviteDialog";
import { ScopeAssignmentDialog } from "@/features/team/components/ScopeAssignmentDialog";
import { RotateKeyDialog } from "@/features/team/components/RotateKeyDialog";
import { TeamDesktopRow, TeamMobileCard } from "@/features/team/components/TeamRow";

const EMPTY_FILTERS: TeamFilters = { query: "", role: "all", status: "all" };
const ROLE_OPTIONS = ["admin", "staff"] as const;
const STATUS_OPTIONS = ["active", "inactive"] as const;
const PAGE_SIZE = 10;

export function TeamList() {
  const t = useT("team");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TeamFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<TeamSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scopeUser, setScopeUser] = useState<TeamMember | null>(null);
  const [rotatedKey, setRotatedKey] = useState<{ apiKey: string; name: string } | null>(null);
  const deferredFilters = useDeferredValue(filters);

  const isAdmin = identity?.role === "admin";
  const withHeader = (body: ReactNode) => (
    <>
      <PageHeader
        title={t("header.title")}
        actions={
          isAdmin &&
          members !== null && (
            <Button type="button" onClick={() => setInviteOpen(true)}>
              <UserPlus size={16} aria-hidden="true" />
              {t("invite_user")}
            </Button>
          )
        }
      />
      {body}
    </>
  );

  async function load() {
    setLoadError(null);
    try {
      setMembers(await listAllTeamMembers());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (isAdmin) void load();
  }, [identity?.role, identity?.scopes.join(",")]);
  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection]);

  if (!isAdmin)
    return withHeader(
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
    return withHeader(
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (members === null)
    return withHeader(
      <div className="overflow-hidden rounded-xl shadow-card">
        <TableSkeleton columns={5} />
      </div>
    );

  const filtered = filterTeamMembers(members, deferredFilters);
  const sorted = sortTeamMembers(filtered, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = paginateTeamMembers(sorted, safePage, PAGE_SIZE);
  const hasFilters =
    filters.query.trim() !== "" ||
    filters.role !== "all" ||
    filters.status !== "all";

  function onSort(key: string) {
    const cast = key as TeamSortKey;
    if (sortKey === cast)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(cast);
      setSortDirection("asc");
    }
  }

  async function onRotateApiKey(member: TeamMember) {
    if (
      !(await confirm({
        title: t("rotate_key_dialog.confirm_title", { name: member.name }),
        description: t("rotate_key_dialog.confirm_description"),
        confirmLabel: t("rotate_key_dialog.confirm_button"),
        tone: "danger",
      }))
    )
      return;
    try {
      const result = await rotateTeamMemberApiKey(member.id);
      setRotatedKey({ apiKey: result.apiKey, name: member.name });
      notify.success(t("api_key_generated"));
    } catch (cause) {
      setActionError(teamErrorMessage(cause, t));
      notify.error(t("api_key_generation_failed"));
    }
  }

  const rowActions = {
    onView: (item: TeamMember) =>
      window.location.assign(`/team/${encodeURIComponent(item.id)}`),
    onManageScopes: setScopeUser,
    onRotateApiKey: (item: TeamMember) => void onRotateApiKey(item),
  };

  return withHeader(
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="contents">
            <SearchInput
              value={filters.query}
              onChange={(query) =>
                setFilters((current) => ({ ...current, query }))
              }
              placeholder={t("search_placeholder")}
              className="basis-full sm:basis-72"
            />
            <span className="order-last ms-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{t("count", { count: filtered.length })}</span>
          </div>
          <div className="contents">
            <Select
              aria-label={t("filters.role")}
              value={filters.role}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  role: event.currentTarget.value as TeamFilters["role"],
                }))
              }
              variant="pill"
              wrapperClassName="w-auto shrink-0"
              triggerClassName="w-auto max-w-56"
            >
              <option value="all">{t("filters.role")}</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {common(`roles.${role}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("filters.status")}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.currentTarget.value as TeamFilters["status"],
                }))
              }
              variant="pill"
              wrapperClassName="w-auto shrink-0"
              triggerClassName="w-auto max-w-56"
            >
              <option value="all">{t("filters.status")}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </Select>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost" size="sm"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                {common("clear_filters")}
              </Button>
            )}
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={
              hasFilters ? common("no_results_found") : t("empty_state.title")
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {visible.map((member) => (
                <TeamMobileCard key={member.id} member={member} {...rowActions} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <SortHeader
                      label={t("table.name")}
                      sortKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.email")}
                      sortKey="email"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.role")}
                      sortKey="role"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <SortHeader
                      label={t("table.status")}
                      sortKey="status"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <TableHead numeric>{t("table.permissions")}</TableHead>
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((member) => (
                    <TeamDesktopRow key={member.id} member={member} {...rowActions} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={sorted.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => void load()}
      />
      {scopeUser && (
        <ScopeAssignmentDialog
          open={scopeUser !== null}
          user={scopeUser}
          onClose={() => setScopeUser(null)}
          onSuccess={() => void load()}
        />
      )}
      <RotateKeyDialog
        open={rotatedKey !== null}
        apiKey={rotatedKey?.apiKey ?? null}
        userName={rotatedKey?.name ?? null}
        onClose={() => setRotatedKey(null)}
      />
    </div>
  );
}
