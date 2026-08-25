import {
  Alert,
  Badge,
  CopyActionIcon,
  Drawer,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { CompiledView } from './CompiledView';
import { useDrawerSurface } from './drawerSurface';
import type { SlotOutlineNode, SpineEntry } from './outline';
import { SOFT_RULE } from './SlotRow';
import { useCompilePreview } from './useWiring';

export interface CompileDrawerProps {
  pack: string;
  /** The roster verb being previewed; `null` closes the drawer. */
  verb: string | null;
  /** What `rt skills check` named as differing on disk for this verb. */
  changedFiles: string[];
  /** The verb's slots, from the composition -- the record of what the body
      SHOULD contain, which the body's own seams cannot supply. */
  slots: SlotOutlineNode[];
  /**
   * Every previewable entry in spine order -- orchestrator, then stages,
   * then everything outside the pipeline -- for the in-drawer switcher
   * (`spineRows(spine)` at the call site). Must come from the UNFILTERED
   * spine, never the attention-filtered `shown`: that filter can collapse
   * the pipeline to a single row, and a switcher fed from it would hide
   * most of what's previewable exactly when a reader is drilling into one
   * drifted stage. `OutsideThePipeline` rows open this same drawer, so
   * outside entries have to ride along too, or the picker shows an empty
   * combobox next to a heading that names a verb it has no option for.
   */
  entries: SpineEntry[];
  /** Fired with the entry to preview next; the caller owns replacing
      `verb`/`changedFiles`/`slots` with THAT entry's own values. */
  onSwitch: (entry: SpineEntry) => void;
  onClose: () => void;
}

/**
 * rt answers a preview of an internal verb by printing a line to stderr and
 * leaving stdout empty, so it reaches the client as an error. It is a fact
 * about the verb -- rt compiles no artifact for it -- and not a failure, so
 * it is pulled out of the surrounding stderr noise and shown plainly. Read
 * from rt's own words rather than re-derived from the roster: the roster
 * knowing a verb is internal is a second answer to a question rt already
 * answered.
 */
function internalNotice(message: string): string | null {
  return /^internal: .+$/m.exec(message)?.[0] ?? null;
}

/**
 * A fresh `rt skills compile --preview` beside the files `check` flagged.
 *
 * It states its own limit in the panel because the two are easy to confuse:
 * this is what a compile WOULD produce, not a diff against the artifact on
 * disk, and there is no confirm button because no write route exists on this
 * surface's server interface.
 */
export function CompileDrawer({
  pack,
  verb,
  changedFiles,
  slots,
  entries,
  onSwitch,
  onClose,
}: CompileDrawerProps) {
  const { bg, text } = useSchemeColors();
  const surface = useDrawerSurface();
  const query = useCompilePreview(pack, verb ?? undefined);
  const internal = query.isError
    ? internalNotice((query.error as Error).message)
    : null;

  // No verb, no seam to preview -- rendering it as an option would be a
  // dead entry the picker can select and never learn anything from.
  const switchable = entries.filter(
    (entry): entry is SpineEntry & { verb: string } => entry.verb !== null
  );
  const toOption = (entry: SpineEntry & { verb: string }) => ({
    value: entry.verb,
    label: entry.label,
  });
  // Same two sections the spine itself draws (the pipeline, then the
  // "Outside the pipeline" timeline item) -- a picker that invented a third
  // name for either would disagree with the page it switches within.
  const switcherData = [
    ...(switchable.some(entry => entry.kind !== 'outside')
      ? [
          {
            group: 'Pipeline',
            items: switchable
              .filter(entry => entry.kind !== 'outside')
              .map(toOption),
          },
        ]
      : []),
    ...(switchable.some(entry => entry.kind === 'outside')
      ? [
          {
            group: 'Outside the pipeline',
            items: switchable
              .filter(entry => entry.kind === 'outside')
              .map(toOption),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      opened={verb !== null}
      onClose={onClose}
      position="right"
      size={720}
      padding="lg"
      styles={{
        ...surface,
        // Mantine's drawer body has no intrinsic height, so a percentage or
        // flex-fill child inside it has nothing to resolve against; making
        // both levels a bounded flex column is what lets the compiled body
        // below claim exactly the space between the alert and the drawer's
        // bottom edge, and scroll on its own rather than the whole drawer.
        content: {
          ...surface.content,
          display: 'flex',
          flexDirection: 'column',
        },
        body: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
      data-testid="compile-drawer"
      title={
        <Stack gap={2}>
          <Text fz="xl" fw={700}>
            {verb}
          </Text>
          {switchable.length > 0 && (
            <Select
              size="xs"
              w={240}
              data={switcherData}
              value={verb}
              onChange={value => {
                const next = switchable.find(entry => entry.verb === value);
                if (next) onSwitch(next);
              }}
              allowDeselect={false}
              aria-label="walk the pipeline"
              data-testid="compile-drawer-switcher"
            />
          )}
          <CommandProvenance
            command={`rt skills compile --verb ${verb} --preview`}
            asOf={query.dataUpdatedAt || undefined}
          />
        </Stack>
      }
    >
      <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
        <Alert variant="light" color="accent" icon={<Icons.info size={14} />}>
          <Text size="xs">
            What a fresh compile would produce. Nothing is written to disk, and
            this is not a diff against the artifact that is there —{' '}
            <Text span fw={600} size="xs">
              rt skills check
            </Text>{' '}
            named the files below as differing.
          </Text>
        </Alert>

        <Stack gap="xs">
          <Text size="xs" c={text.muted}>
            Files check flagged
          </Text>
          {changedFiles.length === 0 ? (
            <Text size="xs" c={text.dimmed} data-testid="no-changed-files">
              None — check found this artifact in sync with its sources.
            </Text>
          ) : (
            <Group gap="xs" wrap="wrap">
              {changedFiles.map(file => (
                <Badge key={file} size="sm" variant="light" color="warn">
                  {file}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>

        <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
          <Group justify="space-between">
            <Text size="xs" c={text.muted}>
              Fresh compile
            </Text>
            {query.data && (
              <CopyActionIcon value={query.data.content} label="Copy body" />
            )}
          </Group>

          {query.isPending && <Skeleton height={240} />}
          {internal && (
            // Drawn on the body's own surface rather than as a coloured
            // Alert: nothing is wrong here, and `color="gray"` reads the
            // border ramp this theme repoints -- see QuietBadge.
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
            <CompiledView body={query.data.content} slots={slots} />
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}
