import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Copy, HelpCircle, Minus } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./input";

/** One line of what an action does: removed (default), kept, or worth a warning. */
export type Consequence = { text: string; kept?: boolean; warning?: boolean };

export type ConfirmDialogOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** What the action takes away, what it keeps, and what to watch — said before it happens. */
  consequences?: ReadonlyArray<Consequence>;
  /**
   * For what cannot be undone: the confirm button stays off until this exact
   * text (a product's name, an order's number) is typed.
   */
  confirmText?: string;
};

type ConfirmRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void;
};

const ConfirmDialogContext = createContext<
  ((options: ConfirmDialogOptions) => Promise<boolean>) | null
>(null);

/**
 * The text to type, shown inside its sentence as a chip that copies itself:
 * the merchant pastes it instead of retyping a long or Arabic name, and still
 * has to put it in the field. The sentence comes whole from the dictionary,
 * so each language keeps its own word order around the chip.
 */
function CopyableText({ text }: { text: string }) {
  const common = useT("common");
  const [copied, setCopied] = useState(false);
  const [before, after = ""] = common("confirm_type", { text: "\u0000" }).split("\u0000");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const range = document.createRange();
      const node = document.getElementById("confirm-dialog-text");
      if (!node) return;
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }

  return (
    <span className="block text-sm text-muted-foreground">
      {before}
      <button
        type="button"
        onClick={() => void copy()}
        title={copied ? common("feedback.copied") : common("confirm_copy")}
        aria-label={`${common("confirm_copy")}: ${text}`}
        className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted px-1.5 py-0.5 align-middle font-mono text-xs font-semibold text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span id="confirm-dialog-text" dir="auto" className="truncate select-all">{text}</span>
        {copied ? (
          <Check size={13} className="shrink-0 text-tone-success-text" aria-hidden="true" />
        ) : (
          <Copy size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status">{copied ? common("feedback.copied") : ""}</span>
      {after}
    </span>
  );
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const common = useT("common");
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const requestRef = useRef<ConfirmRequest | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");

  const confirm = useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        requestRef.current?.resolve(false);
        const next = { ...options, resolve };
        requestRef.current = next;
        setTyped("");
        setRequest(next);
      }),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(confirmed);
  }, []);

  useEffect(() => () => requestRef.current?.resolve(false), []);

  const needsText = Boolean(request?.confirmText);
  const confirmed = !needsText || typed.trim() === request?.confirmText?.trim();

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => settle(false)}
        title={request?.title ?? ""}
        description={request?.description}
        icon={
          request?.tone === "danger" ? (
            <AlertTriangle
              size={18}
              strokeWidth={2}
              className="text-destructive"
              aria-hidden="true"
            />
          ) : (
            <HelpCircle size={18} strokeWidth={2} aria-hidden="true" />
          )
        }
        role="alertdialog"
        initialFocusRef={needsText ? typedRef : cancelRef}
        showClose={false}
        className="max-w-md"
        footer={
          request && (
            <>
              <Button
                ref={cancelRef}
                type="button"
                variant="secondary"
                onClick={() => settle(false)}
              >
                {request.cancelLabel ?? common("cancel")}
              </Button>
              <Button
                type="button"
                variant={request.tone === "danger" ? "danger" : "primary"}
                disabled={!confirmed}
                onClick={() => confirmed && settle(true)}
              >
                {request.confirmLabel ?? common("confirm")}
              </Button>
            </>
          )
        }
      >
        {request && (request.consequences?.length || needsText) ? (
          <div className="space-y-4">
            {request.consequences && request.consequences.length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {request.consequences.map((item) => (
                  <li key={item.text} className="flex items-start gap-2">
                    {item.warning ? (
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-tone-warning-text" aria-hidden="true" />
                    ) : item.kept ? (
                      <Check size={15} className="mt-0.5 shrink-0 text-tone-success-text" aria-hidden="true" />
                    ) : (
                      <Minus size={15} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                    )}
                    <span className="text-foreground">{item.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {needsText && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (confirmed) settle(true);
                }}
              >
                <div className="space-y-1.5">
                  <CopyableText text={request.confirmText!} />
                  <Input
                    ref={typedRef}
                    value={typed}
                    onChange={(event) => setTyped(event.currentTarget.value)}
                    autoComplete="off"
                    spellCheck={false}
                    dir="auto"
                    aria-label={common("confirm_type", { text: request.confirmText! })}
                  />
                </div>
              </form>
            )}
          </div>
        ) : null}
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmDialogContext);
  if (!confirm)
    throw new Error(
      "useConfirmDialog must be used within ConfirmDialogProvider",
    );
  return confirm;
}
