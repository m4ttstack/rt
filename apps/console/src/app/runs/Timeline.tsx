import type { ReactNode } from 'react';
import {
  Anchor,
  Badge,
  Box,
  Group,
  Timeline as MantineTimeline,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';

import { FailureExcerpt } from './FailureExcerpt';
import { STAGE_STATUS_COLOR } from './stageStatus';

/** Same geometry as the Wiring spine (`WiringMap`): a 22px bullet on a 2px
    line, so the two timelines read as one object. */
const BULLET_SIZE = 22;
const LINE_WIDTH = 2;

/**
 * Longest record value that can still share the condensed line. Above it the
 * whole row stacks: a non-current stage renders every record as a sibling of
 * the stage name, so a stage carrying several long ones (`self-review`
 * routinely carries six) splits the line into columns a few words wide and
 * runs off the side of the panel.
 */
const CONDENSED_LINE_MAX = 80;

/**
 * `fields`' primary key is `(run_id, key)`, written via `INSERT OR REPLACE`
 * -- the API can never return two rows sharing a `key` for one run, so this
 * is a plain index, not a dedupe.
 */
export function fieldsByKey(fields: RunFieldRow[]): Map<string, RunFieldRow> {
  const result = new Map<string, RunFieldRow>();
  for (const field of fields) result.set(field.key, field);
  return result;
}

interface StageGroup {
  stage: RunStageRow;
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
}

interface OutsideGroup {
  producedBy: string;
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
}

/**
 * Not every `produced_by`/`decided_by` names a stage -- `rt runs abandon`
 * writes a field attributed to itself, and other out-of-band writers may
 * follow. A name that matches no stage lands in `outsideGroups` rather than
 * being dropped, which is the only thing standing between the reader and a
 * silently hidden abandon reason.
 *
 * A retried stage repeats its `name` across attempts with no attempt number
 * on the field/decision row itself, so attribution resolves to the LAST
 * stage row of that name -- the most recent attempt is where a later event
 * belongs.
 */
export function groupTimeline(
  stages: RunStageRow[],
  fields: RunFieldRow[],
  decisions: RunDecisionRow[]
): { stageGroups: StageGroup[]; outsideGroups: OutsideGroup[] } {
  const stageIndexByName = new Map<string, number>();
  stages.forEach((stage, i) => stageIndexByName.set(stage.name, i));

  const stageGroups: StageGroup[] = stages.map(stage => ({
    stage,
    fields: [],
    decisions: [],
  }));
  const outsideByProducer = new Map<string, OutsideGroup>();

  const outsideGroup = (producedBy: string): OutsideGroup => {
    const existing = outsideByProducer.get(producedBy);
    if (existing) return existing;
    const created = { producedBy, fields: [], decisions: [] };
    outsideByProducer.set(producedBy, created);
    return created;
  };

  for (const field of fields) {
    const idx = stageIndexByName.get(field.produced_by);
    if (idx === undefined) outsideGroup(field.produced_by).fields.push(field);
    else stageGroups[idx].fields.push(field);
  }

  for (const decision of decisions) {
    const idx = stageIndexByName.get(decision.decided_by);
    if (idx === undefined)
      outsideGroup(decision.decided_by).decisions.push(decision);
    else stageGroups[idx].decisions.push(decision);
  }

  return { stageGroups, outsideGroups: [...outsideByProducer.values()] };
}

/** How long a stage took, once it has both ends; a running stage measures
    against now so the number keeps moving while you watch it. */
function stageElapsed(stage: {
  started_at: number | null;
  ended_at: number | null;
}): string | null {
  if (stage.started_at == null) return null;
  const ms = (stage.ended_at ?? Date.now()) - stage.started_at;
  if (ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function StageBullet({ status }: { status: string }) {
  if (status === 'done') return <Icons.check size={12} />;
  if (status === 'failed') return <Icons.error size={12} />;
  if (status === 'running') return <Icons.clock size={12} />;
  if (status === 'redirected') return <Icons.undo size={12} />;
  return null;
}

/** Several recorded fields ARE forge URLs -- `mr` is the merge request, and
    stages are free to record any other link. Rendering them as text makes the
    reader copy-paste a URL that is already sitting in front of them. */
function FieldValue({ value }: { value: string }) {
  const url = /^https?:\/\/\S+$/.test(value.trim()) ? value.trim() : null;
  if (!url) return <>{value}</>;
  return (
    <Anchor href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </Anchor>
  );
}

function FieldRow({ field }: { field: RunFieldRow }) {
  const { text } = useSchemeColors();
  return (
    <Group gap={6} wrap="nowrap" data-testid={`field-${field.key}`}>
      <Text size="sm">
        <Text span fw={600} c={text.muted}>
          {field.key}:
        </Text>{' '}
        <FieldValue value={field.value} />
      </Text>
    </Group>
  );
}

function DecisionRow({ decision }: { decision: RunDecisionRow }) {
  const { text } = useSchemeColors();
  return (
    <Text size="sm" c={text.muted}>
      decision · {decision.contract} → {decision.selection}
    </Text>
  );
}

/**
 * All-or-nothing, so records keep the order a stage recorded them in: one
 * long value would squeeze its neighbours whether or not they are short.
 */
export function condensesToLine(
  fields: RunFieldRow[],
  decisions: RunDecisionRow[]
): boolean {
  return (
    fields.every(field => field.value.length <= CONDENSED_LINE_MAX) &&
    decisions.every(
      decision =>
        decision.contract.length + decision.selection.length <=
        CONDENSED_LINE_MAX
    )
  );
}

/**
 * A non-current stage's records, either alongside the stage name or stacked
 * beneath it. Only `condensesToLine` decides which -- see its rule.
 */
function CondensedStage({
  summary,
  fields,
  decisions,
}: {
  summary: ReactNode;
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
}) {
  const records = (
    <>
      {fields.map(field => (
        <FieldRow key={field.key} field={field} />
      ))}
      {decisions.map(decision => (
        <DecisionRow
          key={`${decision.contract}-${decision.scope}-${decision.decided_at}`}
          decision={decision}
        />
      ))}
    </>
  );

  if (!condensesToLine(fields, decisions)) {
    return (
      <Stack
        gap={4}
        data-testid="timeline-stage-condensed"
        data-layout="stacked"
      >
        {summary}
        {records}
      </Stack>
    );
  }

  return (
    <Group
      gap="md"
      // Wrap rather than divide a fixed width: short records still outrun the
      // line at a narrow viewport, and a nowrap row answers that by shrinking
      // every column instead of moving one down.
      wrap="wrap"
      // Top-align: when a field value wraps the row grows tall, and centering
      // it would drop the stage name below the bullet. The name stays on the
      // first line, by the check.
      align="flex-start"
      data-testid="timeline-stage-condensed"
      data-layout="line"
    >
      {summary}
      {records}
    </Group>
  );
}

export interface TimelineProps {
  repo: string;
  runId: string;
  stages: RunStageRow[];
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
  /** `run.current_stage` -- names the stage that stays expanded; every other
      stage (done or not) collapses to a condensed line. */
  currentStage: string | null;
}

/**
 * Same "last attempt wins" rule `groupTimeline` already applies to field/
 * decision attribution: a retried stage repeats its name across attempts, so
 * the LAST stageGroup matching `currentStage` is the live one.
 */
function findCurrentIndex(
  stageGroups: StageGroup[],
  currentStage: string | null
): number {
  let found = -1;
  stageGroups.forEach((group, i) => {
    if (group.stage.name === currentStage) found = i;
  });
  return found;
}

/**
 * Fields and decisions render inside the stage that produced them, never in
 * a separate tab -- provenance in place is the entire point of stamping an
 * event with its stage.
 */
/**
 * Everything recorded against the run by something other than a pipeline
 * stage: the skill that started it, the run's own identity, and decisions a
 * person made. Grouped by writer, which is the only thing these records have
 * in common.
 */
export function RunContext({
  fields,
  decisions,
  stages,
}: Pick<TimelineProps, 'fields' | 'decisions' | 'stages'>) {
  const { text } = useSchemeColors();
  const { outsideGroups } = groupTimeline(stages, fields, decisions);

  if (outsideGroups.length === 0) {
    return (
      <Text size="sm" c={text.muted} data-testid="run-context-empty">
        Everything on this run was recorded by a pipeline stage.
      </Text>
    );
  }

  return (
    <Stack gap="md" data-testid="run-context">
      <Text size="xs" c={text.muted}>
        Recorded against the run itself, not by a pipeline stage.
      </Text>
      {outsideGroups.map(group => (
        <Stack key={group.producedBy} gap={4}>
          <Text size="xs" fw={600} c={text.muted}>
            {group.producedBy}
          </Text>
          {group.fields.map(field => (
            <FieldRow key={field.key} field={field} />
          ))}
          {group.decisions.map(decision => (
            <DecisionRow
              key={`${decision.contract}-${decision.scope}-${decision.decided_at}`}
              decision={decision}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

export function Timeline({
  repo,
  runId,
  stages,
  fields,
  decisions,
  currentStage,
}: TimelineProps) {
  const { text, bg, border } = useSchemeColors();
  const { stageGroups } = groupTimeline(stages, fields, decisions);
  const currentIndex = findCurrentIndex(stageGroups, currentStage);

  return (
    <Stack gap="sm" data-testid="timeline-surface">
      <Text fw={700} size="sm">
        Pipeline
      </Text>
      <MantineTimeline
        active={stageGroups.length}
        bulletSize={BULLET_SIZE}
        lineWidth={LINE_WIDTH}
        data-testid="run-timeline"
      >
        {stageGroups.map(
          ({ stage, fields: stageFields, decisions: stageDecisions }, i) => {
            const isCurrent = i === currentIndex;
            const summary = (
              // Match the bullet's height and center within it, so the stage
              // name aligns to the check mark rather than sitting ~2px below
              // its center (a top-aligned 22px bullet is taller than the name).
              <Group gap="xs" wrap="nowrap" mih={BULLET_SIZE} align="center">
                {/* Fixed width: without it a long name wraps and pushes its
                    own status badge into an ellipsis, and every row's detail
                    text starts at a different x. */}
                <Text fw={600} w={104} style={{ flex: 'none' }}>
                  {stage.name}
                </Text>
                {stage.attempt > 1 && (
                  <Badge size="xs" variant="light" color="gray">
                    attempt {stage.attempt}
                  </Badge>
                )}
                {/* The check mark on the rail already says "done"; a badge
                    repeating it on every completed row is the noise the
                    condensed timeline exists to remove. Anything else still
                    earns a badge. */}
                {stage.status !== 'done' && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={STAGE_STATUS_COLOR[stage.status] ?? 'gray'}
                  >
                    {stage.status}
                  </Badge>
                )}
                {stageElapsed(stage) && (
                  <Text span c={text.muted} fz={11}>
                    {stageElapsed(stage)}
                  </Text>
                )}
              </Group>
            );

            return (
              <MantineTimeline.Item
                key={`${stage.name}-${stage.attempt}`}
                bullet={<StageBullet status={stage.status} />}
                color={STAGE_STATUS_COLOR[stage.status] ?? 'gray'}
                data-testid={`timeline-stage-${stage.name}-${stage.attempt}`}
                title={
                  isCurrent ? (
                    summary
                  ) : (
                    <CondensedStage
                      summary={summary}
                      fields={stageFields}
                      decisions={stageDecisions}
                    />
                  )
                }
              >
                {isCurrent && (
                  <Box
                    data-testid="timeline-current-stage"
                    bg={bg.lightened('accent')}
                    p={14}
                    mt={4}
                    style={{
                      border: border.style('accent'),
                      borderRadius: 8,
                    }}
                  >
                    <Stack gap={4}>
                      {stage.status === 'failed' && (
                        <>
                          {stage.reason && (
                            <Text size="sm" c={text.highContrast('bad')}>
                              {stage.reason}
                            </Text>
                          )}
                          {stage.detail_path && (
                            <FailureExcerpt
                              repo={repo}
                              runId={runId}
                              detailPath={stage.detail_path}
                            />
                          )}
                        </>
                      )}
                      {stageFields.map(field => (
                        <FieldRow key={field.key} field={field} />
                      ))}
                      {stageDecisions.map(decision => (
                        <DecisionRow
                          key={`${decision.contract}-${decision.scope}-${decision.decided_at}`}
                          decision={decision}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
              </MantineTimeline.Item>
            );
          }
        )}
      </MantineTimeline>
    </Stack>
  );
}
