/**
 * Reports a composed page that did not render the saved document cleanly, for
 * the operator's logs: why the theme's default rendered instead, and each
 * instance-level reason ("sections[3] unknown-type" is actionable; "the page
 * degraded" is not). A store that never saved the surface reports nothing.
 */
import type { SurfaceDocument } from "@wocart/theme";

export function reportSurface(surface: string, resolved: SurfaceDocument, warn: (...data: unknown[]) => void = console.warn): void {
  if (resolved.reason !== null && resolved.reason !== "absent") {
    warn(`[theme-00] ${surface}: rendered the theme's default (${resolved.reason})`);
  }
  if (resolved.issues.length > 0) {
    warn(
      `[theme-00] ${surface}: ${resolved.issues.length} issue(s)`,
      resolved.issues.map((issue) => `${issue.path || "<document>"} ${issue.code}: ${issue.message}`),
    );
  }
}
