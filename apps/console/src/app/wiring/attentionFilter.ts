import { needsAttention, type OutlineCheck, type WiringSpine } from './outline';

const ATTENTION_PARAM = 'attention';

export const WIRING_HREF = '/wiring';
export const WIRING_ATTENTION_HREF = `${WIRING_HREF}?${ATTENTION_PARAM}=1`;

/**
 * The filter rides the URL rather than React state because the control that
 * turns it on -- the rail badge -- is mounted outside the Wiring route and
 * cannot share state with it.
 */
export function isAttentionOnly(search: string): boolean {
  return new URLSearchParams(search).get(ATTENTION_PARAM) === '1';
}

/** How many verbs `check` reported on. */
export function comparedVerbCount(check: OutlineCheck): number {
  return check.verbs.length;
}

/**
 * The same spine with the healthy rows dropped. Not a second list: the
 * caller renders what comes back through the components it already uses, so
 * pipeline order survives -- the law that order comes from
 * `pipelines[workType]` does not stop applying because the list got shorter.
 *
 * `attentionCount` is deliberately left untouched, and orphaned fills are
 * dropped: `buildSpine` never counted them, so keeping them would leave the
 * filtered list longer than the badge that reached it.
 */
export function onlyNeedsAttention(spine: WiringSpine): WiringSpine {
  return {
    ...spine,
    orchestrator:
      spine.orchestrator && needsAttention(spine.orchestrator)
        ? spine.orchestrator
        : null,
    stages: spine.stages.filter(needsAttention),
    outside: spine.outside.filter(needsAttention),
    orphans: [],
  };
}
