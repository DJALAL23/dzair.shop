/**
 * The scheduled Sweep (cod-shared/media/CONTEXT.md): uploads never finished
 * after a day, and files nothing has shown for 30 days. It runs as a dry run
 * and logs its report, so the debt is visible daily; letting it delete is a
 * deliberate, separate change.
 */
import { mediaOf } from "@/lib/media";
import type { Env } from "@/types/env";

export async function runMediaSweep(env: Env): Promise<void> {
  const report = await mediaOf(env).sweep({ dryRun: true });
  const bytes = report.orphans.reduce((total, orphan) => total + (orphan.bytes ?? 0), 0);
  console.log(`[cron:media-sweep] dry-run: ${report.scanned} considered, ${report.orphans.length} to forget, ${bytes} bytes`);
}
