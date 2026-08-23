import {
  Alert,
  Badge,
  Code,
  CopyActionIcon,
  Drawer,
  Group,
  Skeleton,
  Stack,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { useCompilePreview } from './useWiring';

export interface CompileDrawerProps {
  pack: string;
  /** The roster verb being previewed; `null` closes the drawer. */
  verb: string | null;
  /** What `rt skills check` named as differing on disk for this verb. */
  changedFiles: string[];
  onClose: () => void;
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
  onClose,
}: CompileDrawerProps) {
  const { bg, text } = useSchemeColors();
  const query = useCompilePreview(pack, verb ?? undefined);

  return (
    <Drawer
      opened={verb !== null}
      onClose={onClose}
      position="right"
      size={720}
      padding="lg"
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
          {query.isError && (
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
            <div
              style={{
                flex: 1,
                minHeight: 0,
                maxHeight: '60vh',
                overflow: 'auto',
                background: bg.level3,
                border: `1px solid var(--mantine-color-gray-3)`,
                borderRadius: 4,
                padding: 'var(--mantine-spacing-md)',
              }}
              data-testid="compile-preview-body"
            >
              {/* Compiled SKILL.md carries long frontmatter lines; wrapping
                  them keeps the drawer's only scroll vertical. */}
              <Code
                block
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {query.data.content}
              </Code>
            </div>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}
