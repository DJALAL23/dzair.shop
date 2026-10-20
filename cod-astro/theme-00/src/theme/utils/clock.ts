/**
 * A length in milliseconds as a clock reading: "m:ss", minutes unbounded. Used
 * for a voice note's length and its position while it plays (in the browser
 * too, so it must stay free of server-only imports).
 */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
