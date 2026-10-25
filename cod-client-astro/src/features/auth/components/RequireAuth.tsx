import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchIdentity, knownIdentity, watchIdentity } from "@/lib/session";
import { resolveGate, signInRedirect, type GateState, type Identity } from "@/lib/gate";
import GateSpinner from "@/features/auth/components/GateSpinner";
import { Alert, Button } from "@/components/ui";
import { useT } from "@/i18n/react";
import { revealGate, hideGateSpinner } from "@/lib/reveal";

const IdentityContext = createContext<Identity | null>(null);

/** RBAC-aware UI consumes identity through this hook only. */
export function useIdentity(): Identity | null {
  return useContext(IdentityContext);
}

/** True when the caller may act under the given scope (admin bypasses). */
export function canScope(identity: Identity | null, scope: string): boolean {
  if (!identity) return false;
  if (identity.role === "admin") return true;
  return identity.scopes.includes(scope);
}

/**
 * The merchant, for chrome that lives outside a page's gate (the dashboard
 * frame). Renders nothing until the server answers signed in, and follows
 * every later answer; the page's own gate sends anyone else away.
 */
export function SignedIn({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(() => knownIdentity() ?? null);

  useEffect(() => {
    let alive = true;
    const stop = watchIdentity(setIdentity);
    fetchIdentity().then(
      (id) => {
        if (alive) setIdentity(id);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!identity) return null;
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

/**
 * The gate every authenticated page mounts inside its root island.
 * Silent by design: at most one unlabeled skeleton while the session is
 * checked or the redirect fires — never labeled intermediate states.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useT("auth");
  const common = useT("common");
  // A page reached by a click inside the dashboard already has the answer: no spinner.
  const [state, setState] = useState<GateState>(() => resolveGate(knownIdentity()));
  const [identity, setIdentity] = useState<Identity | null>(() => knownIdentity() ?? null);
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let alive = true;
    if (check > 0) setState("pending");
    fetchIdentity().then(
      (id) => {
        if (!alive) return;
        setIdentity(id ?? null);
        setState(resolveGate(id));
      },
      () => {
        if (alive) setState("unavailable");
      },
    );
    return () => {
      alive = false;
    };
  }, [check]);

  useEffect(() => {
    if (state === "anonymous") {
      window.location.replace(signInRedirect(window.location.pathname));
    }
    if (state === "authenticated" || state === "unavailable") {
      revealGate("required");
      hideGateSpinner("required");
    }
  }, [state]);

  if (state === "unavailable") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Alert role="alert" tone="critical" className="max-w-md">
          <span className="flex-1">{auth("session_unavailable")}</span>
          <Button type="button" variant="ghost" onClick={() => setCheck((n) => n + 1)}>
            {common("retry")}
          </Button>
        </Alert>
      </div>
    );
  }

  if (state !== "authenticated") {
    return (
      <div
        data-auth-state={state}
        className="flex min-h-[60vh] items-center justify-center"
        aria-busy="true"
      >
        <GateSpinner />
      </div>
    );
  }

  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}
