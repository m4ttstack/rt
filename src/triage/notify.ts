import { homedir } from "os";
import { join } from "path";

/** rt-tray's notify socket; contract matches repo-tools commands/settings.ts
    test-push: POST /notify {id, title, message, category, timestamp}. */
export const TRAY_SOCK = join(homedir(), ".rt", "tray.sock");

/** Escalation-only notification (ruling 3: quiet on success). rt mode pushes
    tray+sound with an osascript fallback; badge-only does nothing -- the
    board's error badge is then the whole signal. Best-effort by design:
    a missing tray must never fail the caller. */
export async function notifyEscalation(
  title: string,
  message: string,
  mode: "rt" | "badge-only",
  traySock: string = TRAY_SOCK,
): Promise<void> {
  if (mode !== "rt") return;
  const event = { id: crypto.randomUUID(), title, message, category: "mr-doctor", timestamp: Date.now() };
  try {
    const res = await fetch("http://localhost/notify", {
      unix: traySock,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    } as RequestInit);
    if (res.ok) return;
  } catch {
    // tray absent or dead -- fall through to osascript
  }
  try {
    Bun.spawnSync([
      "osascript",
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Basso"`,
    ]);
  } catch {
    // no notifier available; the board badge remains the signal
  }
}
