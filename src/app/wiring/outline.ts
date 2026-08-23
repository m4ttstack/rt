import type { InferResponseType } from 'hono/client';

import type { client } from '../api';

export type SkillsComposition = InferResponseType<
  typeof client.api.skills.composition.$get,
  200
>;
export type SkillsCheck = InferResponseType<
  typeof client.api.skills.check.$get,
  200
>;

type CompositionVerb = SkillsComposition['verbs'][number];
type CompositionFill = SkillsComposition['fills'][number];
type CheckVerb = SkillsCheck['verbs'][number];

/** Only the fields the tree shape needs -- `pack`/`packDir` ride along on
    the real response but buildOutline has no use for them. */
export interface OutlineComposition {
  verbs: CompositionVerb[];
  fills: CompositionFill[];
  binders?: SkillsComposition['binders'];
}
export interface OutlineCheck {
  verbs: CheckVerb[];
}

export type WiringHealth =
  | 'in-sync'
  | 'source-newer'
  | 'never-compiled'
  | 'internal-unchecked'
  | 'orphaned'
  | 'unknown';

export interface BoundFill {
  binding: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
}

export interface SlotOutlineNode {
  name: string;
  contract: string;
  required: boolean;
  boundTo: string | null;
  resolveError?: string;
  fill: BoundFill | null;
}

export interface VerbOutlineNode {
  kind: 'verb';
  verb: string;
  fill?: undefined;
  engineRef: string | null;
  engineError?: string;
  public: boolean;
  sourcePath: string | null;
  artifactPath: string;
  health: WiringHealth;
  staleFiles: string[];
  orphanFiles: string[];
  slots: SlotOutlineNode[];
}

export interface OrphanFillOutlineNode {
  kind: 'orphan-fill';
  verb?: undefined;
  fill: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
  health: 'orphaned';
}

export type OutlineNode = VerbOutlineNode | OrphanFillOutlineNode;

/** `check.status` names rt's own vocabulary; `internal-unchecked` is rt
    deliberately skipping the missing-output check for a non-public verb,
    not a fifth degree of drift -- it must never collapse into
    `never-compiled` or this view can never reach empty. */
function healthFromStatus(
  status: CheckVerb['status'] | undefined
): WiringHealth {
  switch (status) {
    case 'in-sync':
      return 'in-sync';
    case 'stale':
      return 'source-newer';
    case 'never-compiled':
      return 'never-compiled';
    case 'internal-unchecked':
      return 'internal-unchecked';
    default:
      return 'unknown';
  }
}

/**
 * Shapes `verbs[]` (the roster) and `fills[]`/`binders[]` (the binding
 * universe) into the nested outline the Wiring surface renders: one
 * top-level node per verb with its slots and their bound fills nested
 * underneath, followed by every fill no binder claims.
 *
 * Orphan detection reads `binders[]`, not just each verb's own
 * `slots[].boundTo` -- a fill can be bound by a pipeline stage or another
 * plugin's skill, never by a roster verb, and `binders[]` is the only place
 * that binding is visible.
 */
export function buildOutline(
  composition: OutlineComposition,
  check: OutlineCheck
): OutlineNode[] {
  const checkByName = new Map(check.verbs.map(v => [v.name, v] as const));
  const fillsByBinding = new Map(
    composition.fills.map(f => [f.binding, f] as const)
  );

  const boundBindings = new Set<string>();
  for (const verb of composition.verbs) {
    for (const slot of verb.slots) {
      if (slot.boundTo) boundBindings.add(slot.boundTo);
    }
  }
  for (const binder of composition.binders ?? []) {
    for (const slot of binder.slots) {
      boundBindings.add(slot.boundTo);
    }
  }

  const verbNodes: VerbOutlineNode[] = composition.verbs.map(verb => {
    const checkRow = checkByName.get(verb.name);
    return {
      kind: 'verb',
      verb: verb.name,
      engineRef: verb.engineRef,
      engineError: verb.engineError,
      public: verb.public,
      sourcePath: verb.sourcePath,
      artifactPath: verb.artifactPath,
      health: healthFromStatus(checkRow?.status),
      staleFiles: checkRow?.staleFiles ?? [],
      orphanFiles: checkRow?.orphanFiles ?? [],
      slots: verb.slots.map(slot => ({
        name: slot.name,
        contract: slot.contract,
        required: slot.required,
        boundTo: slot.boundTo,
        resolveError: slot.resolveError,
        fill: slot.boundTo ? (fillsByBinding.get(slot.boundTo) ?? null) : null,
      })),
    };
  });

  const orphanNodes: OrphanFillOutlineNode[] = composition.fills
    .filter(fill => !boundBindings.has(fill.binding))
    .map(fill => ({
      kind: 'orphan-fill',
      fill: fill.binding,
      provides: fill.provides,
      sourcePath: fill.sourcePath,
      registered: fill.registered,
      health: 'orphaned',
    }));

  return [...verbNodes, ...orphanNodes];
}
