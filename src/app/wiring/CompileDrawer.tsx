import {
  Alert,
  Badge,
  CopyActionIcon,
  Drawer,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { CompiledView } from './CompiledView';
import { useDrawerSurface } from './drawerSurface';
import type { SlotOutlineNode } from './outline';
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
  onClose,
}: CompileDrawerProps) {
  const { bg, text } = useSchemeColors();
  const surface = useDrawerSurface();
  const query = useCompilePreview(pack, verb ?? undefined);
  const internal = query.isError
    ? internalNotice((query.error as Error).message)
    : null;

  return (
    <Drawer
      opened={verb !== null}
      onClose={onClose}
      position="right"
      size={720}
      padding="lg"
      styles={surface}
      data-testid="compile-drawer"
      title={
        <Stack gap={2}>
          <Text fz="xl" fw={700}>
            {verb}
          </Text>
          <CommandProvenance
            command={`rt skills compile --verb ${verb} --preview`}
            asOf={query.dataUpdatedAt || undefined}
          />
        </Stack>
      }
    >
      <Stack gap="md" style={{ height: '100%', minHeight: 0 }}>
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
