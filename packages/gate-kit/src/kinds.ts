/** Which board lifecycle a gate kind's answered-state and tab belong to. */
export type GateDomain = 'review' | 'respond' | 'doctor';

/** Every gate kind the board knows, kept beside domainForKind so the two can
    never drift apart -- the board's resume wiring walks this list to build
    its resumers map, and its kind-sync guard test ties the wrapper skills'
    declared kinds to exactly this set. */
export const GATE_KINDS = [
  'review-post',
  'respond-plan',
  'respond-post',
  'doctor-escalation',
] as const;

/** A kind outside this map (present or future) has no lifecycle to join
    against and must be skipped, never crashed on -- console's run-scoped
    kinds (self-review, clarify, ...) flow through here as undefined by
    design. */
export function domainForKind(kind: string): GateDomain | undefined {
  if (kind === 'review-post') return 'review';
  if (kind === 'respond-plan' || kind === 'respond-post') return 'respond';
  if (kind === 'doctor-escalation') return 'doctor';
  return undefined;
}
