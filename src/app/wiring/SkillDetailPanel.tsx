import { useEffect, useState } from 'react';

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CompiledView } from './CompiledView';
import { HealthChip } from './HealthChip';
import { InverseIndex } from './InverseIndex';
import type { BindingSite, SkillsComposition, SpineEntry } from './outline';
import { QuietBadge } from './QuietBadge';
import { Rebind } from './Rebind';
import { SlotRow, SOFT_RULE } from './SlotRow';
import { useCompilePreview, useSkillsApply } from './useWiring';
import { VersionTimeline } from './VersionTimeline';

/** Detail.dc.html lifts these paddings straight from the artboard: the rem
    spacing ladder does not land on 14/16px, so those two stay literal, but
    the 18px sides/bottom ARE `spacing.xxl` and use the token. dtabs inset
    matches dhead. */
const HEAD_PAD = '16px var(--mantine-spacing-xxl) 14px';
const BODY_PAD = '16px var(--mantine-spacing-xxl) var(--mantine-spacing-xxl)';
const TAB_INSET = 18;

/** The vivid accent (Detail.dc.html `--tk-accent`), not the muted per-scheme
    border shade: the selected slot card and the mini-list's selected row both
    outline in the full accent. */
const ACCENT = 'var(--mantine-color-accent-filled)';

/**
 * The kind tell in the panel header, worded the same way the spine row is:
 * `stage N` for a numbered stage, the accent `orchestrator` badge, and the
 * muted qualifiers for the rest. A public roster verb outside the pipeline
 * earns none -- there is nothing to qualify.
 */
function KindBadge({ entry }: { entry: SpineEntry }) {
  if (entry.kind === 'orchestrator') {
    return (
      <Badge size="sm" variant="light" color="accent">
        orchestrator
      </Badge>
    );
  }
  if (entry.step !== null)
    return <QuietBadge>{`stage ${entry.step}`}</QuietBadge>;
  if (entry.external) {
    return (
      <Badge size="sm" variant="light" color="purple">
        another plugin
      </Badge>
    );
  }
  if (entry.unwired) return <QuietBadge>unwired</QuietBadge>;
  if (!entry.invocable) return <QuietBadge>internal</QuietBadge>;
  return null;
}

/** A verb-less entry (a pipeline stage) has no artifact of its own, so the
    Compiled/History tabs have nothing to answer for. Said as the plain fact
    it is rather than left blank. */
function NoVerbNote({ what }: { what: string }) {
  const { text } = useSchemeColors();
  return (
    <Text size="sm" c={text.muted} data-testid="detail-no-verb">
      {`A pipeline stage compiles into the orchestrator, so it has no ${what} of its own.`}
    </Text>
  );
}

/** rt answers a preview of an internal verb by printing a line to stderr and
    leaving stdout empty, so it reaches the client as an error. It is a fact
    about the verb, not a failure -- pulled out of the surrounding stderr
    noise and shown plainly. */
function internalNotice(message: string): string | null {
  return /^internal: .+$/m.exec(message)?.[0] ?? null;
}

/**
 * The compiled body for this verb, fetched on demand and read through the same
 * `CompiledView` the old drawer used. States its own limit inline: it is what
 * a fresh compile WOULD produce, not a diff against the artifact on disk.
 */
function CompiledTab({ entry, pack }: { entry: SpineEntry; pack: string }) {
  const { bg, text } = useSchemeColors();
  const query = useCompilePreview(pack, entry.verb ?? undefined);

  if (!entry.verb) return <NoVerbNote what="compiled artifact" />;

  const internal = query.isError
    ? internalNotice((query.error as Error).message)
    : null;

  return (
    <Stack
      gap="sm"
      style={{ flex: 1, minHeight: 0 }}
      data-testid="detail-compiled"
    >
      <Alert
        variant="light"
        color="accent"
        icon={<Icons.info size={14} />}
        // The compiled body below is the flex:1 scroller; without this the
        // alert shrinks below its content and clips its icon.
        style={{ flex: 'none' }}
      >
        <Text size="xs">
          What a fresh compile would produce. Nothing is written to disk, and
          this is not a diff against the artifact that is there.
        </Text>
      </Alert>

      {query.isPending && <Skeleton height={240} />}
      {internal && (
        <Paper
          bg={bg.level3}
          p="md"
          radius="sm"
          style={{ border: `1px solid ${SOFT_RULE}` }}
          data-testid="compile-preview-internal"
        >
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Icons.info size={14} color={text.muted} />
            <Stack gap={2}>
              <Text size="xs">{internal}</Text>
              <Text size="xs" c={text.muted}>
                rt compiles no artifact for a roster verb the pack&apos;s
                surface does not publish, so there is no body to preview.
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}
      {query.isError && !internal && (
        <Alert
          variant="light"
          color="bad"
          icon={<Icons.error size={14} />}
          data-testid="compile-preview-error"
        >
          <Text size="xs">{(query.error as Error).message}</Text>
        </Alert>
      )}
      {query.data && (
        <CompiledView body={query.data.content} slots={entry.slots} />
      )}
    </Stack>
  );
}

export interface SkillDetailPanelProps {
  pack: string;
  entry: SpineEntry;
  composition: SkillsComposition;
  /** The whole-manifest inversion the Used-by tab reads (`bindingSites[boundTo]`). */
  bindingSites: Record<string, BindingSite[]>;
  /** `dataUpdatedAt` off the composition query, for the Used-by provenance. */
  asOf?: number;
  onClose: () => void;
  onCopyContext: () => void;
  /** A Used-by site's "show in map" jumps the split view to that site's own
      skill; the caller resolves the site's ref to a spine row and selects it. */
  onShowInMap: (site: BindingSite) => void;
}

/**
 * One place per skill, replacing the drawers the spine used to fan out into:
 * the header carries what the row's action cluster used to (open source, copy
 * agent context) plus the public/internal switch, and the sub-tabs hold the
 * slot wiring, the compiled body, the version history and the inverse index.
 *
 * Rebind mounts INLINE in the slot card rather than in its own drawer -- the
 * same `Rebind` body, staging the same `rt skills bind` command, with the card
 * outlined in accent while it is open. A slot's fill link / `N sites` chip
 * switches to the Used-by tab focused on that fill, rather than opening a
 * fifth drawer.
 */
export function SkillDetailPanel({
  pack,
  entry,
  composition,
  bindingSites,
  asOf,
  onClose,
  onCopyContext,
  onShowInMap,
}: SkillDetailPanelProps) {
  const { bg, text, border } = useSchemeColors();
  const { bind, surfaceApply } = useSkillsApply(pack);
  const [tab, setTab] = useState<string | null>('slots');
  const [activeRebind, setActiveRebind] = useState<string | null>(null);
  // The fill the Used-by tab answers for. Defaults to the entry's first bound
  // slot; a slot's fill link retargets it and switches to that tab.
  const primaryFill = entry.slots.find(slot => slot.boundTo)?.boundTo ?? null;
  const [usedByFill, setUsedByFill] = useState<string | null>(primaryFill);
  // A rebind of the primary slot changes what the tab answers for -- follow
  // it rather than staying pinned to the fill this panel opened with. Only
  // fires on a real change to `primaryFill`, so a manual "N sites" pick
  // (`showSites` below) survives any other re-render.
  useEffect(() => {
    setUsedByFill(primaryFill);
  }, [primaryFill]);

  // `rt skills bind` is verb-scoped, so a stage (no roster verb) has no legal
  // rebind target -- its slots read but do not offer the action.
  const canRebind = Boolean(entry.verb);

  const bindError = bind.isError
    ? (bind.error as Error).message
    : bind.data && !bind.data.ok
      ? (bind.data.error ?? 'rt exited nonzero')
      : null;

  const surfaceError = surfaceApply.isError
    ? (surfaceApply.error as Error).message
    : surfaceApply.data && !surfaceApply.data.steps.every(step => step.ok)
      ? (surfaceApply.data.steps.find(step => !step.ok)?.error ??
        'surface change failed')
      : null;

  const openRebind = (slotName: string) => {
    setActiveRebind(current => (current === slotName ? null : slotName));
    bind.reset();
  };

  const showSites = (binding: string) => {
    setUsedByFill(binding);
    setTab('usedby');
  };

  const toggleSurface = () => {
    if (!entry.verb) return;
    const verb = entry.verb;
    surfaceApply.mutate(
      entry.invocable
        ? { toPublic: [], toInternal: [verb] }
        : { toPublic: [verb], toInternal: [] }
    );
  };

  const usedBySource = usedByFill
    ? (composition.fills.find(f => f.binding === usedByFill)?.sourcePath ??
      null)
    : null;

  return (
    <Paper
      bg={bg.level2}
      radius="xl"
      data-testid="skill-detail-panel"
      style={{ border: `1px solid ${border.default}`, overflow: 'hidden' }}
    >
      <div
        style={{ padding: HEAD_PAD, borderBottom: `1px solid ${SOFT_RULE}` }}
      >
        <Group gap="sm" wrap="nowrap" align="center">
          <Text fz={16} fw={700} style={{ flex: 'none' }}>
            {entry.label}
          </Text>
          <KindBadge entry={entry} />
          <HealthChip health={entry.health} />
          <div aria-hidden style={{ flex: 1 }} />
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onClose}
            aria-label="close detail panel"
            data-testid="close-detail"
          >
            <Icons.close size={18} />
          </ActionIcon>
        </Group>

        {entry.ref && (
          <Text size="sm" c={text.muted} mt={4}>
            {entry.ref}
          </Text>
        )}

        <Group gap="xs" wrap="wrap" align="center" mt="sm">
          <Group gap="xs" wrap="nowrap" mr="xs">
            <Switch
              size="sm"
              checked={entry.invocable}
              disabled={!entry.verb || surfaceApply.isPending}
              onChange={toggleSurface}
              aria-label={`make ${entry.label} public or internal`}
              data-testid="surface-switch"
            />
            <Text size="sm" c={text.muted}>
              {entry.invocable ? 'public' : 'internal'}
            </Text>
          </Group>

          {entry.sourcePath && (
            <Button
              component="a"
              href={`vscode://file${entry.sourcePath}`}
              size="xs"
              variant="default"
              leftSection={<Icons.edit size={14} />}
              data-testid="open-source"
            >
              Open source
            </Button>
          )}
          {entry.verb && (
            <Button
              size="xs"
              variant="default"
              leftSection={<Icons.copy size={14} />}
              onClick={onCopyContext}
              data-testid="copy-agent-context"
            >
              Copy agent context
            </Button>
          )}
        </Group>

        {surfaceError && (
          <Alert
            variant="light"
            color="bad"
            icon={<Icons.error size={14} />}
            mt="sm"
          >
            <Text size="xs">{surfaceError}</Text>
          </Alert>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        color="accent"
        keepMounted={false}
        data-testid="skill-detail-tabs"
      >
        <Tabs.List
          style={{
            background: bg.level3,
            paddingLeft: TAB_INSET,
            paddingRight: TAB_INSET,
          }}
        >
          <Tabs.Tab value="slots">Slots &amp; bindings</Tabs.Tab>
          <Tabs.Tab value="compiled">Compiled</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
          <Tabs.Tab value="usedby">Used by</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="slots" style={{ padding: BODY_PAD }}>
          <Stack gap="xs" data-testid="detail-slots">
            {entry.slots.length === 0 ? (
              <Text size="sm" c={text.muted}>
                {entry.note ?? 'This skill takes nothing from the pack.'}
              </Text>
            ) : (
              entry.slots.map(slot => {
                const editing = activeRebind === slot.name;
                return (
                  <Paper
                    key={slot.name}
                    bg={bg.level3}
                    radius="lg"
                    data-testid={`slot-card-${slot.name}`}
                    style={{
                      border: `1px solid ${editing ? ACCENT : SOFT_RULE}`,
                      boxShadow: editing
                        ? `0 0 0 1px ${ACCENT} inset`
                        : undefined,
                    }}
                  >
                    <SlotRow
                      slot={slot}
                      onShowSites={showSites}
                      onRebind={canRebind ? openRebind : undefined}
                    />
                    {editing && entry.verb && (
                      <Box
                        px="md"
                        pb="md"
                        pt="xs"
                        style={{ borderTop: `1px solid ${SOFT_RULE}` }}
                      >
                        <Rebind
                          pack={pack}
                          verb={entry.verb}
                          slot={slot.name}
                          composition={composition}
                          applying={bind.isPending}
                          applyError={bindError}
                          onApply={fill =>
                            bind.mutate(
                              {
                                verb: entry.verb as string,
                                slot: slot.name,
                                fill,
                              },
                              {
                                onSuccess: data =>
                                  data.ok && setActiveRebind(null),
                              }
                            )
                          }
                          onClose={() => setActiveRebind(null)}
                        />
                      </Box>
                    )}
                  </Paper>
                );
              })
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel
          value="compiled"
          style={{
            padding: BODY_PAD,
            // A bounded-height flex ancestor for `CompiledTab`'s own
            // `flex:1; min-height:0` body -- without one, that scroll never
            // engages and a long compiled body grows the whole page instead
            // of scrolling in place.
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '70vh',
            minHeight: 0,
          }}
        >
          <CompiledTab entry={entry} pack={pack} />
        </Tabs.Panel>

        <Tabs.Panel value="history" style={{ padding: BODY_PAD }}>
          {entry.verb ? (
            <VersionTimeline
              pack={pack}
              verb={entry.verb}
              refName={entry.ref}
              health={entry.health}
              staleFiles={entry.staleFiles}
              sourcePath={entry.sourcePath}
              artifactPath={entry.artifactPath}
              slots={entry.slots}
            />
          ) : (
            <NoVerbNote what="version history" />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="usedby" style={{ padding: BODY_PAD }}>
          {usedByFill ? (
            <InverseIndex
              pack={pack}
              fill={usedByFill}
              sites={bindingSites[usedByFill] ?? []}
              sourcePath={usedBySource}
              asOf={asOf}
              onShowInMap={onShowInMap}
            />
          ) : (
            <Text size="sm" c={text.muted} data-testid="detail-usedby-empty">
              This skill binds no fills, so nothing points back through it.
            </Text>
          )}
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
