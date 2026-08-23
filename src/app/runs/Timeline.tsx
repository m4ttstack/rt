import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';

import {
  Badge,
  Group,
  Timeline as MantineTimeline,
  Stack,
  Text,
} from '@ui/core';
import type { MantineColor } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { FailureExcerpt } from './FailureExcerpt';

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

const STAGE_STATUS_COLOR: Record<string, MantineColor> = {
  done: 'ok',
  failed: 'bad',
  running: 'accent',
};

function StageBullet({ status }: { status: string }) {
  if (status === 'done') return <Icons.check size={12} />;
  if (status === 'failed') return <Icons.error size={12} />;
  if (status === 'running') return <Icons.clock size={12} />;
  return null;
}

function FieldRow({ field }: { field: RunFieldRow }) {
  const { text } = useSchemeColors();
  return (
    <Group gap={6} wrap="nowrap" data-testid={`field-${field.key}`}>
      <Text size="sm">
        <Text span fw={600} c={text.muted}>
          {field.key}:
        </Text>{' '}
        {field.value}
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

export interface TimelineProps {
  repo: string;
  runId: string;
  stages: RunStageRow[];
  fields: RunFieldRow[];
  decisions: RunDecisionRow[];
}

/**
 * Fields and decisions render inside the stage that produced them, never in
 * a separate tab -- provenance in place is the entire point of stamping an
 * event with its stage.
 */
export function Timeline({
  repo,
  runId,
  stages,
  fields,
  decisions,
}: TimelineProps) {
  const { text } = useSchemeColors();
  const { stageGroups, outsideGroups } = groupTimeline(
    stages,
    fields,
    decisions
  );

  return (
    <MantineTimeline
      active={stageGroups.length}
      bulletSize={22}
      lineWidth={2}
      data-testid="run-timeline"
    >
      {stageGroups.map(
        ({ stage, fields: stageFields, decisions: stageDecisions }) => (
          <MantineTimeline.Item
            key={`${stage.name}-${stage.attempt}`}
            bullet={<StageBullet status={stage.status} />}
            color={STAGE_STATUS_COLOR[stage.status] ?? 'gray'}
            data-testid={`timeline-stage-${stage.name}-${stage.attempt}`}
            title={
              <Group gap="xs" wrap="nowrap">
                <Text fw={600}>{stage.name}</Text>
                {stage.attempt > 1 && (
                  <Badge size="xs" variant="light" color="gray">
                    attempt {stage.attempt}
                  </Badge>
                )}
                <Badge
                  size="xs"
                  variant="light"
                  color={STAGE_STATUS_COLOR[stage.status] ?? 'gray'}
                >
                  {stage.status}
                </Badge>
              </Group>
            }
          >
            <Stack gap={4} mt={4}>
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
          </MantineTimeline.Item>
        )
      )}
      {outsideGroups.length > 0 && (
        <MantineTimeline.Item
          bullet={<Icons.link size={12} />}
          color="gray"
          title="Outside the pipeline"
          data-testid="timeline-outside-pipeline"
        >
          <Stack gap="sm" mt={4}>
            {outsideGroups.map(group => (
              <Stack key={group.producedBy} gap={4}>
                <Text size="xs" c={text.muted}>
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
        </MantineTimeline.Item>
      )}
    </MantineTimeline>
  );
}
