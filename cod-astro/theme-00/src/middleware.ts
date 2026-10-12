// Astro requires middleware in src/middleware.ts. This file is framework
// wiring only. Two jobs, in order:
//
// 1. Store context (Theme Zero S2): `locals.store` is the ONE acquisition
//    point for { config, content, isRTL } — pages, layouts and (later) any
//    request-scoped reader take it from `Astro.locals`, never by calling
//    `getStoreContext()` themselves. `/api/*` endpoints are skipped: they
//    never render the shell and call the SDK client directly. The config read
//    behind it is cached per client scope, so this costs one fetch per isolate.
// 2. The SDK's PRG decision: on an action error the shopper is sent back to
//    the form with a 303; on success call next() so the result cookie
//    survives — see resolveActionRedirectDecision.
import { defineMiddleware } from "astro:middleware";
import { getActionContext } from "astro:actions";
import { resolveActionRedirectDecision } from "@codflow/storefront/astro";
import { getStoreContext } from "@/theme/runtime/store";

export const onRequest = defineMiddleware(async (context, next) => {
  // Store context first: the action handler runs inside the PRG decision below
  // and may read `context.locals`, and the page that renders afterwards needs
  // it too. `/api/*` endpoints are skipped — they never render the shell and
  // call the SDK client directly. The config read is cached per client scope.
  if (!context.url.pathname.startsWith("/api/")) {
    context.locals.store = await getStoreContext();
  }

  const { action, setActionResult, serializeActionResult } =
    getActionContext(context);

  const decision = await resolveActionRedirectDecision({
    action: action && {
      calledFrom: action.calledFrom,
      name: action.name,
      handler: action.handler,
    },
    setActionResult,
    serializeActionResult,
    referer: context.request.headers.get("Referer"),
    pathname: context.url.pathname,
  });

  if (decision.kind === "redirect") {
    return context.redirect(decision.location, decision.status);
  }

  return next();
});