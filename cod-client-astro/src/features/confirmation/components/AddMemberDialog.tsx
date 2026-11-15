import { useEffect, useState } from "react";
import { ExternalLink, UserRound } from "lucide-react";
import { useTeamError } from "@/features/confirmation/errors";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Alert, Button, Dialog, SwitchField } from "@/components/ui";
import { Choice } from "@/features/orders/components/HandoffDialog";
import { addTeamMember, listCandidates } from "@/features/confirmation/api";
import type { TeamCandidate } from "@/features/confirmation/types";

/**
 * Adding one of the store's people to the confirmation team. Each person
 * shows which orders their permissions let them work; someone who would see
 * none is told so before they are added, with a link to their permissions.
 */
export function AddMemberDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const t = useT("confirmation");
  const explain = useTeamError();
  const [people, setPeople] = useState<TeamCandidate[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCandidates()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const person = people?.find((candidate) => candidate.userId === chosen) ?? null;

  async function submit() {
    if (!person) return;
    setBusy(true);
    setError(null);
    try {
      await addTeamMember(person.userId, receiving);
      notify.success(t("add.added", { name: person.name }));
      onAdded();
      onClose();
    } catch (cause) {
      setError(explain(cause, "members.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("add.title")}
      onClose={onClose}
      footer={
        people && people.length > 0 ? (
          <Button type="button" className="w-full" disabled={!person || busy} onClick={() => void submit()}>
            {person ? t("add.submit_name", { name: person.name }) : t("add.submit")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {people === null ? (
          <div className="h-32 shimmer rounded-lg" />
        ) : people.length === 0 ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t("add.none_left")}</p>
            <a href="/team" className="inline-flex items-center gap-1.5 font-semibold text-foreground underline underline-offset-4">
              {t("add.open_team")}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label={t("add.member")} className="space-y-1.5">
              {people.map((candidate) => (
                <Choice key={candidate.userId} selected={chosen === candidate.userId} onSelect={() => setChosen(candidate.userId)}>
                  <span className="flex items-center gap-2.5">
                    <UserRound size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{candidate.name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">{candidate.email}</span>
                    </span>
                    <span className={`shrink-0 text-xs ${candidate.reach === "none" ? "font-semibold text-[var(--tone-warning-text)]" : "font-normal text-muted-foreground"}`}>
                      {t(`members.reach_${candidate.reach}`)}
                    </span>
                  </span>
                </Choice>
              ))}
            </div>
            {person?.reach === "none" && (
              <Alert tone="warning">
                <div className="space-y-1.5">
                  <p>{t("add.no_access", { name: person.name })}</p>
                  <a href={`/team/${encodeURIComponent(person.userId)}`} className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4">
                    {t("add.open_permissions")}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              </Alert>
            )}
            <SwitchField label={t("add.receiving")} help={t("add.receiving_help")} checked={receiving} onChange={setReceiving} />
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
