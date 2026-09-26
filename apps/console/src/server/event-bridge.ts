import {
  deckAppUrl,
  reconcileEventBridgeRule,
  type EventBridgeRule,
} from '@mattstack/app-server/event-bridge';
import { getSetting, setSetting } from '@mattstack/rt-client';

/** The rule this console contributes so opening a gate raises a desktop
    notification that opens the gate in the console on click. `subjectPrefix:
    'run:'` is the rule's identity half that keeps it from colliding with the
    board's `mr:` rule on the same `gate/opened/*` pattern. `owner: 'human'`
    keeps herd-owned worker gates silent: the shepherd answers those, so only
    a run the human drives may notify. */
export function consoleBridgeRule(consoleUrl: string): EventBridgeRule {
  return {
    pattern: 'gate/opened/*',
    subjectPrefix: 'run:',
    category: 'gate',
    title: '{label}',
    message: '{question}',
    url: `${consoleUrl}/gates/{id}`,
    owner: 'human',
  };
}

function readEventBridges(): EventBridgeRule[] {
  return getSetting<EventBridgeRule[]>('rt.notify.eventBridges').value ?? [];
}

function writeEventBridges(next: EventBridgeRule[]): void {
  setSetting('rt.notify.eventBridges', next, 'user');
}

/**
 * Boot step: reconcile `consoleBridgeRule` in `rt.notify.eventBridges`
 * against deck's local url for this app (see `reconcileEventBridgeRule` for
 * what happens when deck does not answer). `read`/`write`/`resolveUrl`
 * default to the real settings store and deck lookup, and are seams for
 * tests -- this function never touches deck or a settings store directly.
 */
export async function installConsoleBridgeRule(
  opts: {
    read?: () => EventBridgeRule[];
    write?: (next: EventBridgeRule[]) => void;
    resolveUrl?: () => Promise<string | null>;
  } = {}
): Promise<void> {
  const resolveUrl = opts.resolveUrl ?? (() => deckAppUrl('console'));
  reconcileEventBridgeRule({
    app: 'console',
    deckUrl: await resolveUrl(),
    rule: consoleBridgeRule,
    read: opts.read ?? readEventBridges,
    write: opts.write ?? writeEventBridges,
  });
}
