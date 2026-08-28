import { useMemo } from 'react';

import { Anchor, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { buildSpine } from './outline';
import { SkillRow } from './SkillRow';
import { SkillSplitLayout } from './SkillSplitLayout';
import { useSkillSelection } from './useSkillSelection';
import { useComposition, useSkillsCheck } from './useWiring';

export interface OnDemandViewProps {
  pack: string;
  workType: string | null;
  /** Group 3 (unwired) is a pointer, not a list -- clicking it switches the
      page to the tab that already draws these rows in detail. */
  onGoToHealth: () => void;
}

/**
 * The one coherent piece of the old "Not run by this pipeline" section,
 * promoted to its own tab: skills invoked by name rather than run by the
 * pipeline (Group 1 -- see `outline.ts`'s `external`/`unwired` fields). The
 * other two groups the old section bundled in are demoted here rather than
 * dropped: another plugin's binders get one muted footnote line, and the
 * skills and fills nothing binds get a count that points at the Health tab,
 * which lists them together under Unwired.
 *
 * Shares the split-view + detail-panel machinery with `WiringSpineView`
 * (`SkillSplitLayout` + `useSkillSelection`) rather than duplicating it --
 * clicking a Group 1 row opens the exact same panel a pipeline row does.
 */
export function OnDemandView({
  pack,
  workType,
  onGoToHealth,
}: OnDemandViewProps) {
  const { text } = useSchemeColors();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);

  const spine = useMemo(
    () =>
      buildSpine(
        compositionQuery.data,
        checkQuery.data ?? { verbs: [] },
        workType
      ),
    [compositionQuery.data, checkQuery.data, workType]
  );

  const invocable = useMemo(
    () => spine.outside.filter(entry => !entry.external && !entry.unwired),
    [spine.outside]
  );
  // `external` groups are already one row per OTHER plugin (see
  // `buildSpine`'s `externalGroups`), so this list IS the plugin names --
  // no separate dedupe needed.
  const externalPlugins = useMemo(
    () =>
      spine.outside.filter(entry => entry.external).map(entry => entry.label),
    [spine.outside]
  );
  const unwiredCount =
    spine.outside.filter(entry => entry.unwired).length + spine.orphans.length;

  const selection = useSkillSelection({
    pack,
    entries: invocable,
    composition: compositionQuery.data,
  });
  const { panelOpen, selectedKey, setSelectedKey } = selection;

  return (
    <SkillSplitLayout
      pack={pack}
      composition={compositionQuery.data}
      bindingSites={spine.bindingSites}
      asOf={compositionQuery.dataUpdatedAt || undefined}
      selection={selection}
      splitTestId="ondemand-split"
      paperTestId="ondemand-list"
      left={
        <Stack gap="sm" data-testid="ondemand-body">
          {!panelOpen && (
            <Text size="xs" c={text.muted} data-testid="ondemand-note">
              Skills you invoke directly by name -- no run order, no stage
              number.
            </Text>
          )}

          {invocable.length === 0 ? (
            <Text size="sm" c={text.dimmed} data-testid="ondemand-empty">
              No skills are invoked outside the pipeline.
            </Text>
          ) : (
            <Stack gap={panelOpen ? 2 : 'sm'} data-testid="ondemand-rows">
              {invocable.map(entry => (
                <SkillRow
                  key={entry.key}
                  entry={entry}
                  slim
                  compact={panelOpen}
                  selected={panelOpen && entry.key === selectedKey}
                  onOpen={() => setSelectedKey(entry.key)}
                />
              ))}
            </Stack>
          )}

          {externalPlugins.length > 0 && (
            <Text
              size="xs"
              c={text.muted}
              data-testid="ondemand-external-footnote"
            >
              Also bound by{' '}
              {externalPlugins.length === 1
                ? 'another plugin'
                : 'other plugins'}
              : {externalPlugins.join(', ')}
            </Text>
          )}

          {unwiredCount > 0 && (
            <Anchor
              component="button"
              type="button"
              onClick={onGoToHealth}
              size="xs"
              c={text.muted}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
              data-testid="ondemand-unwired-pointer"
            >
              {unwiredCount} unwired {unwiredCount === 1 ? 'skill' : 'skills'} →
              Health
            </Anchor>
          )}
        </Stack>
      }
    />
  );
}
