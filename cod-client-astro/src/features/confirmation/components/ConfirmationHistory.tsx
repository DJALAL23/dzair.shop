import { useState } from "react";
import { CheckCircle2, History, PackagePlus, PhoneMissed, UserRound, UserX, XCircle } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Button, Dialog } from "@/components/ui";
import { storeClock } from "@/features/confirmation/model";
import { assignmentWay, confirmationHistory, gapLine, historyGaps, type Gap, type HistoryEntry } from "@/features/confirmation/history";
import type { OrderDetail } from "@/features/orders/types";

/**
 * The order's confirmation, kept out of the way: a button in the team card
 * that opens a side sheet, with who had the order, each call without an
 * answer and the decision, newest first, each at its time. Nothing to open
 * while there is only one thing to tell.
 */
export function ConfirmationHistoryButton({ order }: { order: Pick<OrderDetail, "statusHistory" | "assignmentHistory" | "unansweredCalls"> }) {
  const t = useT("confirmation");
  const [open, setOpen] = useState(false);
  const entries = confirmationHistory(order);
  if (entries.length < 2) return null;
  const gaps = historyGaps(entries);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <History size={14} aria-hidden="true" />
        {t("order.history")}
      </Button>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          placement="end"
          icon={<History size={17} aria-hidden="true" />}
          title={t("order.history_title")}
          description={t("order.history_subtitle")}
        >
          <ol className="space-y-4">
            {entries.map((entry) => (
              <Entry key={`${entry.kind}:${entry.id}`} entry={entry} gap={gaps.get(entry.id)} />
            ))}
          </ol>
        </Dialog>
      )}
    </>
  );
}

const MARK = {
  placed: { icon: PackagePlus, tone: "bg-muted text-muted-foreground" },
  handover: { icon: UserRound, tone: "bg-muted text-muted-foreground" },
  unassigned: { icon: UserX, tone: "bg-muted text-muted-foreground" },
  call: { icon: PhoneMissed, tone: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]" },
  confirmed: { icon: CheckCircle2, tone: "bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]" },
  cancelled: { icon: XCircle, tone: "bg-[var(--tone-critical-bg)] text-[var(--tone-critical-text)]" },
} as const;

function Entry({ entry, gap }: { entry: HistoryEntry; gap?: Gap }) {
  const t = useT("confirmation");
  const orders = useT("orders");
  const locale = useLocale();

  const [mark, title, detail] =
    entry.kind === "handover"
      ? [entry.step.to ? MARK.handover : MARK.unassigned, entry.step.to ? t("order.with", { name: entry.step.to.name }) : t("order.nobody"), assignmentWay(t, entry.step)]
      : entry.status === "new"
        ? [MARK.placed, t("order.placed"), null]
        : entry.status === "unreachable"
          ? [MARK.call, entry.call === null ? orders("status.unreachable") : orders("calls.no_answer", { call: entry.call }), entry.byName]
          : [MARK[entry.status], orders(`status.${entry.status}`), entry.byName];
  const Icon = mark.icon;

  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${mark.tone}`}>
        <Icon size={13} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={entry.at} className="tabular-nums">
            {storeClock(entry.at, locale, true)}
          </time>
          {detail && ` · ${detail}`}
          {gap && ` · ${gapLine(t, gap)}`}
        </p>
      </div>
    </li>
  );
}
