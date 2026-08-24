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
type CompositionBinder = NonNullable<SkillsComposition['binders']>[number];
type CheckVerb = SkillsCheck['verbs'][number];

/** Only the fields the spine needs -- `pack`/`packDir` ride along on the
    real response but `buildSpine` has no use for them. */
export interface SpineComposition {
  verbs: CompositionVerb[];
  fills: CompositionFill[];
  binders?: CompositionBinder[];
  pipelines?: Record<string, string[]>;
}
export interface OutlineCheck {
  verbs: CheckVerb[];
}

/** The verb that reads the pipeline and runs it. It leads the spine because
    it is the only skill that has a position relative to ALL the stages. */
export const ORCHESTRATOR_VERB = 'work';

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
  /**
   * A roster verb declares its slots' contracts; a stage or cross-plugin
   * binder carries only `name -> boundTo`, so the contract shown for those
   * is what the BOUND FILL provides, not what the slot demands. Null when
   * neither is known, which renders as "contract unknown" rather than blank.
   */
  contract: string | null;
  /** Null where the payload never states it -- a binder-only slot. */
  required: boolean | null;
  boundTo: string | null;
  resolveError?: string;
  fill: BoundFill | null;
  /** Binding sites across the whole manifest that resolve to this fill. */
  siteCount: number;
  /**
   * Whether the compiler vendors this fill's body into the verb's artifact
   * (`true`) or leaves a reference to it (`false`) -- the reason a compiled
   * body carries a seam for some fills and no trace of others. Null where rt
   * states neither, which is a slot that is unbound or known only from a
   * binder; three states, and collapsing null into false would claim a
   * reference the compiler never emitted.
   */
  inlined: boolean | null;
}

export type BindingSiteKind = CompositionBinder['kind'];

/** One place in the manifest that resolves to a fill: a ref, the slot on it,
    and what that ref is. `verb` is null wherever the ref is not a roster
    verb, which is most of them. */
export interface BindingSite {
  ref: string;
  verb: string | null;
  kind: BindingSiteKind;
  slot: string;
}

/** Kinds ahead of names, so the drawer reads in the order its own sentence
    names them. Any order would render; a STABLE one is what keeps the list
    from moving under the cursor between fetches of the same pack. */
const SITE_KIND_RANK: Record<BindingSiteKind, number> = {
  verb: 0,
  stage: 1,
  skill: 2,
  external: 3,
};

export type SpineEntryKind = 'orchestrator' | 'stage' | 'outside';

export interface SpineEntry {
  kind: SpineEntryKind;
  key: string;
  label: string;
  /** The manifest binding key, e.g. `mattstack:stage-ship`. Null for a
      grouped cross-plugin entry, which stands for several refs. */
  ref: string | null;
  /** The roster verb backing this entry, when there is one. */
  verb: string | null;
  /** 1..N for a stage; null everywhere else. Never replaced by health. */
  step: number | null;
  /** A roster verb with a public artifact -- the only thing rt checks. */
  invocable: boolean;
  /** A binder belonging to another plugin's roster, not this pack's. */
  external: boolean;
  /** A roster verb no binder names. It binds nothing, so the manifest never
      mentions it and the pipeline never reaches it -- but it still compiles
      to an artifact `check` covers, so it can drift. */
  unwired: boolean;
  sourcePath: string | null;
  artifactPath: string | null;
  health: WiringHealth;
  engineError?: string;
  staleFiles: string[];
  orphanFiles: string[];
  /** Stated where a reader would otherwise see an empty row. */
  note?: string;
  /** An outside skill whose slots bind exactly what a stage binds. */
  sameWiringAsStep?: number;
  slots: SlotOutlineNode[];
}

export interface OrphanFillEntry {
  fill: string;
  provides: string;
  sourcePath: string;
  registered: boolean;
  health: 'orphaned';
}

/**
 * `absent` is an rt whose `composition --json` predates the `pipelines`
 * field; `empty` is that rt answering for a pack whose manifest declares no
 * pipeline. Same spine, different sentence -- collapsing them would tell a
 * reader to fix their manifest when the fix is to update rt.
 */
export type PipelineState = 'ok' | 'empty' | 'absent';

export interface WiringSpine {
  /** Fill binding -> every site that resolves to it. The slot rows' `N
      sites` chip is this map's lengths, so the chip and the inverse index
      cannot disagree about the same fill. */
  bindingSites: Record<string, BindingSite[]>;
  workType: string | null;
  workTypes: string[];
  pipelineState: PipelineState;
  orchestrator: SpineEntry | null;
  stages: SpineEntry[];
  outside: SpineEntry[];
  orphans: OrphanFillEntry[];
  attentionCount: number;
}

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

export function suffixOf(ref: string): string {
  const colon = ref.indexOf(':');
  return colon === -1 ? ref : ref.slice(colon + 1);
}

export function pluginOf(ref: string): string {
  const colon = ref.indexOf(':');
  return colon === -1 ? ref : ref.slice(0, colon);
}

/**
 * Every fill the pack declares, mapped to every binding site that resolves
 * to it. A declared fill nothing binds gets an empty array rather than no
 * key: absent and bound-by-nothing are different facts, and a missing key
 * would render as "unknown" where the honest answer is "bound by nothing".
 *
 * Inverts `binders[]`, never `verbs[]`. The roster holds roughly a third of
 * the manifest's binding keys -- the rest are pipeline stages, other
 * plugins' skills, and mattstack skills that are neither -- so a
 * roster-derived index reports genuinely-bound fills as orphaned in the one
 * view consulted before deleting something. Nor is `Resolved.bindings`
 * inverted directly: its outer key is `${step.plugin}:${verb.engine}`, an
 * engine ref, not a verb name.
 *
 * Unioning `verbs[]` in would add nothing: rt reads a verb slot's `boundTo`
 * out of the same `resolved.bindings` map it emits every `binders[]` entry
 * from, so `binders[]` is a superset of the roster's bindings by
 * construction (measured on the live demo pack: 18 binders cover all
 * 12 verbs' bound slots, ref/slot/binding identical).
 */
export function invertBindings(
  composition: SpineComposition
): Record<string, BindingSite[]> {
  const sites: Record<string, BindingSite[]> = {};
  for (const fill of composition.fills) sites[fill.binding] = [];

  for (const binder of composition.binders ?? []) {
    for (const slot of binder.slots) {
      if (slot.boundTo == null) continue;
      (sites[slot.boundTo] ??= []).push({
        ref: binder.ref,
        verb: binder.verb,
        kind: binder.kind,
        slot: slot.name,
      });
    }
  }

  for (const list of Object.values(sites)) {
    list.sort(
      (a, b) =>
        SITE_KIND_RANK[a.kind] - SITE_KIND_RANK[b.kind] ||
        (a.verb ?? a.ref).localeCompare(b.verb ?? b.ref) ||
        a.slot.localeCompare(b.slot)
    );
  }
  return sites;
}

/** Identity of a binder's wiring, order-insensitive -- what makes "same
    wiring as stage 7" a fact about the bindings rather than about the order
    the manifest happened to list them in. */
function wiringSignature(slots: { name: string; boundTo: string | null }[]) {
  return slots
    .map(s => `${s.name}=${s.boundTo ?? ''}`)
    .sort()
    .join('|');
}

/** Stated where a reader would otherwise be looking at an empty row. */
function noSlotsNote(
  kind: SpineEntryKind,
  slots: SlotOutlineNode[]
): string | undefined {
  if (slots.length > 0) return undefined;
  return kind === 'stage'
    ? 'no slots — this stage takes nothing from the pack'
    : 'no slots — this skill takes nothing from the pack';
}

/**
 * The one predicate behind both `attentionCount` and the "needs attention
 * only" filter -- a badge that disagreed with the list it links to would be
 * two derivations of the same claim.
 *
 * Every signal it reads reaches an entry through a ROSTER VERB: `health`
 * comes from `check` keyed by verb name, `engineError` off the verb, and
 * `required`/`resolveError` off the verb's declared slots. A binder-only
 * slot carries `required: null` and no `resolveError`, and a ref no verb
 * backs gets `health: 'unknown'`. So this can only ever answer true for an
 * entry with `verb !== null` -- which is what makes `attentionCount`
 * independent of the work type. See `buildSpine`.
 */
export function needsAttention(entry: SpineEntry): boolean {
  if (entry.health === 'source-newer' || entry.health === 'never-compiled')
    return true;
  if (entry.engineError) return true;
  return entry.slots.some(
    slot => slot.resolveError || (slot.required === true && !slot.boundTo)
  );
}

/**
 * Every row the spine draws, in render order. Names the set `attentionCount`
 * ranges over so the count, the filter and the summary's "showing N of M"
 * cannot each decide for themselves what a row is. Orphaned fills are not
 * rows: they are fills, and the count never included them.
 */
export function spineRows(
  spine: Pick<WiringSpine, 'orchestrator' | 'stages' | 'outside'>
): SpineEntry[] {
  return [
    ...(spine.orchestrator ? [spine.orchestrator] : []),
    ...spine.stages,
    ...spine.outside,
  ];
}

/**
 * Shapes one pack's composition into the spine the Wiring surface renders:
 * the orchestrator, the pipeline's stages in their run order, every other
 * binder under "Outside the pipeline", and the fills nothing binds.
 *
 * Two invariants the substrate exists to protect:
 *
 * - **Order comes from `pipelines[workType]` and nowhere else.** `binders[]`
 *   is a map, not a sequence; `kind === 'stage'` says a ref IS a stage, never
 *   where it runs. Reconstructing order from it (or sorting it) invents an
 *   order the manifest never stated.
 * - **Orphan detection reads `binders[]`, not `verbs[]`.** A fill can be
 *   bound by a pipeline stage or another plugin's skill and never by a roster
 *   verb; on the live pack, deriving orphans from `verbs[]` wrongly orphans
 *   nine bound fills.
 */
export function buildSpine(
  composition: SpineComposition,
  check: OutlineCheck,
  requestedWorkType?: string | null
): WiringSpine {
  const checkByName = new Map(check.verbs.map(v => [v.name, v] as const));
  const fillsByBinding = new Map(
    composition.fills.map(f => [f.binding, f] as const)
  );
  const binders = composition.binders ?? [];
  const bindersByRef = new Map(binders.map(b => [b.ref, b] as const));
  const verbsByEngineRef = new Map(
    composition.verbs
      .filter(v => v.engineRef !== null)
      .map(v => [v.engineRef as string, v] as const)
  );

  // One inversion, two readers: the chip below counts what the inverse index
  // lists, so the two can never disagree about the same fill.
  const bindingSites = invertBindings(composition);
  const siteCount = (boundTo: string | null) =>
    boundTo ? (bindingSites[boundTo]?.length ?? 0) : 0;

  const boundBindings = new Set<string>();
  for (const verb of composition.verbs) {
    for (const slot of verb.slots) {
      if (slot.boundTo) boundBindings.add(slot.boundTo);
    }
  }
  for (const binder of binders) {
    for (const slot of binder.slots) boundBindings.add(slot.boundTo);
  }

  const workTypes = Object.keys(composition.pipelines ?? {});
  const pipelineState: PipelineState =
    composition.pipelines === undefined
      ? 'absent'
      : workTypes.length === 0
        ? 'empty'
        : 'ok';
  const workType =
    requestedWorkType && workTypes.includes(requestedWorkType)
      ? requestedWorkType
      : (workTypes[0] ?? null);
  const stageRefs = workType ? (composition.pipelines?.[workType] ?? []) : [];

  function slotsFor(
    verb: CompositionVerb | undefined,
    binder: CompositionBinder | undefined
  ): SlotOutlineNode[] {
    const slots: SlotOutlineNode[] = (verb?.slots ?? []).map(slot => ({
      name: slot.name,
      contract: slot.contract,
      required: slot.required,
      boundTo: slot.boundTo,
      resolveError: slot.resolveError,
      fill: slot.boundTo ? (fillsByBinding.get(slot.boundTo) ?? null) : null,
      siteCount: siteCount(slot.boundTo),
      inlined: slot.inlined,
    }));
    const declared = new Set(slots.map(s => s.name));

    for (const slot of binder?.slots ?? []) {
      if (declared.has(slot.name)) continue;
      const fill = fillsByBinding.get(slot.boundTo) ?? null;
      slots.push({
        name: slot.name,
        contract: fill?.provides ?? null,
        required: null,
        boundTo: slot.boundTo,
        fill,
        siteCount: siteCount(slot.boundTo),
        inlined: null,
      });
    }
    return slots;
  }

  function entryFor(
    kind: SpineEntryKind,
    ref: string,
    step: number | null
  ): SpineEntry {
    const binder = bindersByRef.get(ref);
    const verb = verbsByEngineRef.get(ref);
    const checkRow = verb ? checkByName.get(verb.name) : undefined;
    const slots = slotsFor(verb, binder);

    return {
      kind,
      key: ref,
      label: verb?.name ?? suffixOf(ref),
      ref,
      verb: verb?.name ?? null,
      step,
      invocable: verb?.public ?? false,
      external: false,
      unwired: false,
      sourcePath: verb?.sourcePath ?? null,
      artifactPath: verb?.artifactPath ?? null,
      health: healthFromStatus(checkRow?.status),
      engineError: verb?.engineError,
      staleFiles: checkRow?.staleFiles ?? [],
      orphanFiles: checkRow?.orphanFiles ?? [],
      note: noSlotsNote(kind, slots),
      slots,
    };
  }

  const orchestratorVerb = composition.verbs.find(
    v => v.name === ORCHESTRATOR_VERB
  );
  const orchestratorRef = orchestratorVerb?.engineRef ?? null;
  const orchestrator = orchestratorRef
    ? entryFor('orchestrator', orchestratorRef, null)
    : null;

  // A ref the manifest names as a stage always gets a row, whether or not
  // anything in the payload covers it: rt omits a binder for a stage that
  // binds nothing, so "not in binders[]" means "takes nothing from the
  // pack", never "missing".
  const stages = stageRefs.map((ref, i) => entryFor('stage', ref, i + 1));

  const stageStepBySignature = new Map<string, number>();
  for (const stage of stages) {
    const signature = wiringSignature(stage.slots);
    if (signature && !stageStepBySignature.has(signature))
      stageStepBySignature.set(signature, stage.step as number);
  }

  const spineRefs = new Set(stageRefs);
  if (orchestratorRef) spineRefs.add(orchestratorRef);

  const outside: SpineEntry[] = [];
  // Cross-plugin binders group under their plugin: mr-board's four keys are
  // one neighbour of this pack, not four. Each row underneath is one of its
  // binders (name column) at one of that binder's slots (contract column).
  const externalGroups = new Map<string, SpineEntry>();

  for (const binder of binders) {
    if (spineRefs.has(binder.ref)) continue;

    if (binder.kind === 'external') {
      const plugin = pluginOf(binder.ref);
      let group = externalGroups.get(plugin);
      if (!group) {
        group = {
          kind: 'outside',
          key: `external:${plugin}`,
          label: plugin,
          ref: null,
          verb: null,
          step: null,
          invocable: false,
          external: true,
          unwired: false,
          sourcePath: null,
          artifactPath: null,
          health: 'unknown',
          staleFiles: [],
          orphanFiles: [],
          slots: [],
        };
        externalGroups.set(plugin, group);
        outside.push(group);
      }
      for (const slot of binder.slots) {
        const fill = fillsByBinding.get(slot.boundTo) ?? null;
        group.slots.push({
          name: suffixOf(binder.ref),
          contract: slot.name,
          required: null,
          boundTo: slot.boundTo,
          fill,
          siteCount: siteCount(slot.boundTo),
          inlined: null,
        });
      }
      continue;
    }

    const entry = entryFor('outside', binder.ref, null);
    const sameStep = stageStepBySignature.get(wiringSignature(entry.slots));
    if (sameStep !== undefined) entry.sameWiringAsStep = sameStep;
    outside.push(entry);
  }

  // Every roster verb reaches a row. rt emits no binder for a verb that binds
  // nothing, so such a verb is named by neither `binders[]` nor the pipeline
  // and would otherwise render nowhere -- while `check` still reports its
  // drift, which is the exact thing this surface exists to surface.
  const placedVerbs = new Set(
    [orchestrator, ...stages, ...outside]
      .map(entry => entry?.verb)
      .filter((name): name is string => typeof name === 'string')
  );

  for (const rosterVerb of composition.verbs) {
    if (placedVerbs.has(rosterVerb.name)) continue;
    const checkRow = checkByName.get(rosterVerb.name);
    const slots = slotsFor(rosterVerb, undefined);

    outside.push({
      kind: 'outside',
      key: rosterVerb.engineRef ?? `verb:${rosterVerb.name}`,
      label: rosterVerb.name,
      ref: rosterVerb.engineRef,
      verb: rosterVerb.name,
      step: null,
      invocable: rosterVerb.public,
      external: false,
      unwired: true,
      sourcePath: rosterVerb.sourcePath,
      artifactPath: rosterVerb.artifactPath,
      health: healthFromStatus(checkRow?.status),
      engineError: rosterVerb.engineError,
      staleFiles: checkRow?.staleFiles ?? [],
      orphanFiles: checkRow?.orphanFiles ?? [],
      note: noSlotsNote('outside', slots),
      slots,
    });
  }

  const orphans: OrphanFillEntry[] = composition.fills
    .filter(fill => !boundBindings.has(fill.binding))
    .map(fill => ({
      fill: fill.binding,
      provides: fill.provides,
      sourcePath: fill.sourcePath,
      registered: fill.registered,
      health: 'orphaned',
    }));

  // Work-type independence, which the rail badge depends on: the rail has no
  // work-type picker, so it counts against the pack's default while the page
  // counts against whatever the picker says. Those agree because the ONLY
  // rows that come and go with the work type are stage refs that no binder
  // and no roster verb backs -- rt omits a binder for a stage that binds
  // nothing, so such a ref is a row in the work types whose pipeline names it
  // and absent everywhere else. `needsAttention` can never answer true for
  // one (see its comment: every signal arrives via a roster verb), and every
  // roster verb gets exactly one row in EVERY work type -- placed as the
  // orchestrator, a stage or a binder, or swept in unwired just above. So the
  // count cannot move when the work type does.
  const attentionCount = spineRows({ orchestrator, stages, outside }).filter(
    needsAttention
  ).length;

  return {
    bindingSites,
    workType,
    workTypes,
    pipelineState,
    orchestrator,
    stages,
    outside,
    orphans,
    attentionCount,
  };
}
