import { homedir } from 'os';
import { join } from 'path';

/** rt-tray's notify socket; contract matches repo-tools commands/settings.ts
    test-push: POST /notify {id, title, message, category, timestamp, url?}.
    The tray opens `url` on a banner click only when it is http(s). */
export const TRAY_SOCK = join(homedir(), '.mattstack', 'rt', 'tray.sock');

/** The board page a notification about `mrUrl` opens on click: the `?mr=`
    deep link that lands on that MR's row. */
export function boardMrLink(boardUrl: string, mrUrl: string): string {
  return `${boardUrl}/?mr=${encodeURIComponent(mrUrl)}`;
}

const SNIPPET_MAX = 120;

/** One-line tray body for a doctor diagnosis: first sentence, truncated to
    ~120 chars with an ellipsis. The full diagnosis stays in the doctor state
    file and audit log; only the notification shrinks. */
export function escalationBody(diagnosis: string): string {
  const firstLine = diagnosis.trim().split('\n', 1)[0] ?? '';
  const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine;
  return sentence.length > SNIPPET_MAX
    ? `${sentence.slice(0, SNIPPET_MAX).trimEnd()}...`
    : sentence;
}

/** The notification an AUTO doctor escalates with when it hits `error`.
    `boardUrl` is deck's board url, null when deck did not answer, which
    sends the notification with no click target. */
export function doctorStuckNotice(
  doctor: { iid: number; mrUrl: string; message?: string },
  boardUrl: string | null
): { title: string; message: string; url: string | null } {
  const diagnosis = doctor.message?.trim();
  return {
    title: `Auto-fix stuck on !${doctor.iid}`,
    message: diagnosis
      ? escalationBody(diagnosis)
      : 'No reason given, over to you',
    url: boardUrl ? boardMrLink(boardUrl, doctor.mrUrl) : null,
  };
}

/** Escalation-only notification (ruling 3: quiet on success). rt mode pushes
    tray+sound with an osascript fallback; badge-only does nothing -- the
    board's error badge is then the whole signal. Best-effort by design:
    a missing tray must never fail the caller. `url` is the banner's click
    target; the osascript fallback has no way to carry one. */
export async function notifyEscalation(
  title: string,
  message: string,
  mode: 'rt' | 'badge-only',
  opts: { url?: string | null; traySock?: string } = {}
): Promise<void> {
  if (mode !== 'rt') return;
  const event = {
    id: crypto.randomUUID(),
    title,
    message,
    category: 'mr-doctor',
    timestamp: Date.now(),
    ...(opts.url ? { url: opts.url } : {}),
  };
  try {
    const res = await fetch('http://localhost/notify', {
      unix: opts.traySock ?? TRAY_SOCK,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    } as RequestInit);
    if (res.ok) return;
  } catch {
    // tray absent or dead -- fall through to osascript
  }
  try {
    Bun.spawnSync([
      'osascript',
      '-e',
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Basso"`,
    ]);
  } catch {
    // no notifier available; the board badge remains the signal
  }
}
