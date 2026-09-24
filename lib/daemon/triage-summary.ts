export const TRIAGE_CATEGORY = "worktree_triage";
const SEND_HOUR = 9;

export interface SummaryDeps {
  now: () => Date;
  counts: () => Promise<{ needsDecision: number; safe: number }>;
  notify: (title: string, message: string) => void;
  loadLastSent: () => string | null;
  saveLastSent: (day: string) => void;
}

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function maybeSendTriageSummary(deps: SummaryDeps): Promise<boolean> {
  const now = deps.now();
  if (now.getHours() < SEND_HOUR) return false;
  const day = localDay(now);
  if (deps.loadLastSent() === day) return false;
  const { needsDecision, safe } = await deps.counts();
  if (needsDecision <= 0) return false;
  const title = needsDecision === 1 ? "1 worktree needs a decision" : `${needsDecision} worktrees need a decision`;
  const message = safe > 0 ? `${safe} can be cleaned up in one click. Click to review.` : "Click to review.";
  deps.notify(title, message);
  deps.saveLastSent(day);
  return true;
}
