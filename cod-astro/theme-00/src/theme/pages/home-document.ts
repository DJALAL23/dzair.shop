/**
 * Choosing the home document (Phase 6 — cod-sdk/theme-sdk/20).
 *
 * Pure decision, no Astro: the page feeds in what the store saved (the SDK's
 * `pageData.get("home")` — `null` when absent or degraded) and the catalog's
 * type check; this returns the document to render plus what to report.
 *
 * Policy (report 19 §7, tracker D20.6):
 *   - absent (`null`)               → the shipped default
 *   - unparseable / bad version     → the shipped default (saved issues kept
 *                                     for reporting)
 *   - sections that map to NO
 *     catalog type at all           → the shipped default (a theme switch left
 *                                     nothing renderable); a partial overlap
 *                                     renders what maps — the designed degrade
 *   - an EMPTY saved document       → honored as saved (a deliberately
 *                                     emptied page renders empty)
 */

import { parsePageData, validatePageData } from "@codflow/theme";
import type {
  PageDataIssue,
  PageDataResult,
  ResolutionScope,
  ThemeDefinition,
} from "@codflow/theme";
import shipped from "./home.page.json";

export type HomeDocumentReason = "absent" | "invalid" | "no-overlap";

export interface HomeDocumentDecision {
  /** The parsed document to render. */
  result: PageDataResult;
  source: "saved" | "default";
  /** Why the shipped default was chosen; `null` when the saved document won. */
  reason: HomeDocumentReason | null;
  /**
   * What to report. For a saved document these are the catalog's own reasons
   * (`unknown-type`, `unknown-prop`, …) with per-section paths — not just
   * "something did not map".
   */
  issues: PageDataIssue[];
}

/**
 * Choosing the home document (Phase 6 — cod-sdk/theme-sdk/20).
 *
 * Pure decision, no Astro: the page feeds in what the store saved (the SDK's
 * `pageData.get("home")` — `null` when absent or degraded) and the theme
 * catalog; this returns the document to render plus what to report.
 *
 * Two boundaries, deliberately different:
 *
 * - the **shipped default** is code, so it is only *parsed* here — its
 *   conformance is asserted in `__tests__/contracts/catalog-contracts.test.ts`,
 *   not re-checked on every request;
 * - the **saved document** is merchant data, so it is validated *against the
 *   catalog* (`validatePageData`). That is what turns "the page degraded" into
 *   "sections[3] names a component this theme does not define".
 *
 * Policy (report 19 §7, tracker D20.6):
 *   - absent (`null`)               → the shipped default
 *   - unparseable / bad version     → the shipped default (saved issues kept
 *                                     for reporting)
 *   - sections that map to NO
 *     catalog type at all           → the shipped default (a theme switch left
 *                                     nothing renderable); a partial overlap
 *                                     renders what maps — the designed degrade
 *   - an EMPTY saved document       → honored as saved (a deliberately
 *                                     emptied page renders empty)
 */
export function resolveHomeDocument(
  saved: unknown,
  theme: ThemeDefinition,
  scope: ResolutionScope = {},
): HomeDocumentDecision {
  const hasType = (type: string): boolean => Object.hasOwn(theme.components, type);

  if (saved === null || saved === undefined) {
    const result = parsePageData(shipped);
    return { result, source: "default", reason: "absent", issues: result.issues };
  }

  const savedResult = validatePageData(theme, saved, scope);
  if (savedResult.page === null) {
    const result = parsePageData(shipped);
    return {
      result,
      source: "default",
      reason: "invalid",
      issues: [...savedResult.issues, ...result.issues],
    };
  }

  const sections = savedResult.page.sections;
  if (sections.length > 0 && sections.every((section) => !hasType(section.type))) {
    const result = parsePageData(shipped);
    return {
      result,
      source: "default",
      reason: "no-overlap",
      issues: [...savedResult.issues, ...result.issues],
    };
  }

  return {
    result: savedResult,
    source: "saved",
    reason: null,
    issues: savedResult.issues,
  };
}

/**
 * Report a home decision that did not render the saved document cleanly, for
 * the operator's logs: why the default won, and each section-level reason
 * ("sections[3] unknown-type" is actionable; "the page degraded" is not).
 */
export function logHomeDecision(
  decision: HomeDocumentDecision,
  warn: (...data: unknown[]) => void = console.warn,
): void {
  if (decision.reason !== null) {
    warn(
      `[theme-00] home document: ${decision.source} (${decision.reason}); ` +
        `issues: ${decision.issues.length}`,
    );
  }
  if (decision.issues.length > 0) {
    warn(
      `[theme-00] home page data degraded (${decision.issues.length}):`,
      decision.issues.map(
        (issue) => `${issue.path || "<document>"} ${issue.code}: ${issue.message}`,
      ),
    );
  }
}
