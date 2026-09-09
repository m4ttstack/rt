import {
  deckAppUrl,
  ensureEventBridgeRule,
  type EventBridgeRule,
} from '@mattstack/app-server/event-bridge';
import { getSetting, setSetting } from '@mattstack/rt-client';

/** The rule this console contributes so opening a gate raises a desktop
    notification that opens the gate in the console on click. `subjectPrefix:
    'run:'` is the rule's identity half that keeps it from colliding with the
    board's `mr:` rule on the same `gate/opened/*` pattern. */
export function consoleBridgeRule(consoleUrl: string): EventBridgeRule {
  return {
    pattern: 'gate/opened/*',
    subjectPrefix: 'run:',
    category: 'gate',
    title: '{label}',
    message: '{question}',
    url: `${consoleUrl}/gates/{id}`,
  };
}

function readEventBridges(): EventBridgeRule[] {
  return getSetting<EventBridgeRule[]>('rt.notify.eventBridges').value ?? [];
}

function writeEventBridges(next: EventBridgeRule[]): void {
  setSetting('rt.notify.eventBridges', next, 'user');
}

/**
 * Boot step: upsert `consoleBridgeRule` into `rt.notify.eventBridges` once
 * deck's local url for this app resolves (or the given port's localhost
 * fallback, when deck is not running). `read`/`write`/`resolveUrl` default
 * to the real settings store and deck lookup, and are seams for tests --
 * this function never touches deck or a settings store directly.
 */
export async function installConsoleBridgeRule(opts: {
  port: number;
  read?: () => EventBridgeRule[];
  write?: (next: EventBridgeRule[]) => void;
  resolveUrl?: (fallback: string) => Promise<string>;
}): Promise<void> {
  const resolveUrl =
    opts.resolveUrl ?? (fallback => deckAppUrl('console', fallback));
  const consoleUrl = await resolveUrl(`http://localhost:${opts.port}`);
  ensureEventBridgeRule(
    opts.read ?? readEventBridges,
    opts.write ?? writeEventBridges,
    consoleBridgeRule(consoleUrl)
  );
}
