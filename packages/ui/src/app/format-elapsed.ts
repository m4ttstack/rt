export function formatElapsed(ms: number): string {
  ms = Math.max(0, ms);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
