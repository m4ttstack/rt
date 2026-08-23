import { Component, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  Alert,
  Anchor,
  Badge,
  Code,
  GenericError,
  Group,
  LazyLoader,
  NavLink,
  PageShell,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import {
  buildOutline,
  type OrphanFillOutlineNode,
  type VerbOutlineNode,
  type WiringHealth,
} from './outline';
import { SlotNode } from './SlotNode';
import {
  useCompilePreview,
  useComposition,
  usePacks,
  useSkillsCheck,
} from './useWiring';

const HEALTH_META: Record<WiringHealth, { label: string; color: string }> = {
  'in-sync': { label: 'in sync', color: 'ok' },
  'source-newer': { label: 'source newer than compiled', color: 'warn' },
  'never-compiled': { label: 'never compiled', color: 'bad' },
  'internal-unchecked': { label: 'internal, unchecked', color: 'gray' },
  orphaned: { label: 'orphaned', color: 'purple' },
  unknown: { label: 'checking…', color: 'gray' },
};

function HealthBadge({ health }: { health: WiringHealth }) {
  const meta = HEALTH_META[health];
  return (
    <Badge
      size="xs"
      variant="light"
      color={meta.color}
      data-testid="health-badge"
    >
      {meta.label}
    </Badge>
  );
}

/** Reads what a fresh compile would produce, next to what `check` already
    named as differing on disk -- the preview half of "compile with diff"
    (see rt's own `--preview` flag). Nothing here writes; the write side
    needs a mutation route this surface's server interface doesn't have. */
function CompilePreviewPanel({ pack, verb }: { pack: string; verb: string }) {
  const { bg, border, text } = useSchemeColors();
  const query = useCompilePreview(pack, verb);

  return (
    <Stack
      gap={4}
      bg={bg.level3}
      p="xs"
      style={{ borderRadius: 4, border: `1px solid ${border.default}` }}
      data-testid="compile-preview-panel"
    >
      <Text size="xs" c={text.muted}>
        Fresh compile of {verb} -- preview only, nothing written to disk.
      </Text>
      {query.isPending && <Skeleton height={120} />}
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
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <Code block>{query.data.content}</Code>
        </div>
      )}
    </Stack>
  );
}

function VerbRow({
  node,
  pack,
  previewOpen,
  onTogglePreview,
}: {
  node: VerbOutlineNode;
  pack: string;
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const { text } = useSchemeColors();
  // Everything but the quiet states opens by default -- the roster is 12
  // verbs deep on the live pack, and drift is what someone came here to see.
  const opensByDefault =
    node.health !== 'in-sync' && node.health !== 'internal-unchecked';
  const changedFiles = [...node.staleFiles, ...node.orphanFiles];

  return (
    <NavLink
      component="div"
      defaultOpened={opensByDefault}
      data-testid={`verb-node-${node.verb}`}
      label={
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} size="sm">
            {node.verb}
          </Text>
          <HealthBadge health={node.health} />
          {!node.public && (
            <Badge size="xs" variant="outline" color="gray">
              internal
            </Badge>
          )}
          {node.engineError && (
            <Badge size="xs" variant="filled" color="bad">
              engine error
            </Badge>
          )}
        </Group>
      }
      description={node.engineRef ?? 'no engine resolved'}
    >
      <Stack gap="xs" pl="md" py="xs">
        {node.engineError && (
          <Alert
            variant="light"
            color="bad"
            icon={<Icons.warning size={14} />}
            data-testid="engine-error"
          >
            <Text size="xs">{node.engineError}</Text>
          </Alert>
        )}

        <Group gap="md">
          {node.sourcePath ? (
            <Anchor
              href={`vscode://file${node.sourcePath}`}
              size="xs"
              c={text.muted}
              data-testid="open-source"
            >
              <Group gap={4} wrap="nowrap">
                <Icons.edit size={12} />
                open source
              </Group>
            </Anchor>
          ) : (
            <Text size="xs" c={text.dimmed}>
              no source path
            </Text>
          )}
          <Anchor
            href={`vscode://file${node.artifactPath}`}
            size="xs"
            c={text.muted}
            data-testid="reveal-artifact"
          >
            <Group gap={4} wrap="nowrap">
              <Icons.eye size={12} />
              reveal artifact
            </Group>
          </Anchor>
          <Anchor
            component="button"
            type="button"
            size="xs"
            c={text.muted}
            onClick={onTogglePreview}
            data-testid="toggle-compile-preview"
          >
            <Group gap={4} wrap="nowrap">
              <Icons.zap size={12} />
              {previewOpen ? 'hide' : 'preview'} compile
            </Group>
          </Anchor>
        </Group>

        {changedFiles.length > 0 && (
          <Text size="xs" c={text.muted}>
            check flags: {changedFiles.join(', ')}
          </Text>
        )}

        {previewOpen && <CompilePreviewPanel pack={pack} verb={node.verb} />}

        {node.slots.length === 0 ? (
          <Text size="xs" c={text.dimmed} pl="md">
            no slots
          </Text>
        ) : (
          node.slots.map(slot => <SlotNode key={slot.name} slot={slot} />)
        )}
      </Stack>
    </NavLink>
  );
}

function OrphanFillRow({ node }: { node: OrphanFillOutlineNode }) {
  const { text } = useSchemeColors();
  return (
    <Group gap="xs" data-testid={`orphan-fill-${node.fill}`}>
      <HealthBadge health="orphaned" />
      <Text size="sm">{node.fill}</Text>
      <Text size="xs" c={text.muted} truncate>
        {node.provides}
      </Text>
    </Group>
  );
}

function WiringOutline({
  pack,
  previewVerb,
  onTogglePreview,
}: {
  pack: string;
  previewVerb: string | null;
  onTogglePreview: (verb: string | null) => void;
}) {
  const { text } = useSchemeColors();
  const compositionQuery = useComposition(pack);
  const checkQuery = useSkillsCheck(pack);

  const outline = useMemo(
    () => buildOutline(compositionQuery.data, checkQuery.data ?? { verbs: [] }),
    [compositionQuery.data, checkQuery.data]
  );

  const verbNodes = outline.filter(
    (n): n is VerbOutlineNode => n.kind === 'verb'
  );
  const orphanNodes = outline.filter(
    (n): n is OrphanFillOutlineNode => n.kind === 'orphan-fill'
  );

  return (
    <Stack gap="lg" data-testid="wiring-outline">
      <Stack gap={4} data-testid="verb-roster">
        {verbNodes.map(node => (
          <VerbRow
            key={node.verb}
            node={node}
            pack={pack}
            previewOpen={previewVerb === node.verb}
            onTogglePreview={() =>
              onTogglePreview(previewVerb === node.verb ? null : node.verb)
            }
          />
        ))}
      </Stack>

      {orphanNodes.length > 0 && (
        <Stack gap={4} data-testid="orphaned-fills">
          <Text fw={700} size="sm">
            Orphaned fills
          </Text>
          <Text size="xs" c={text.muted}>
            Bound by nothing in this pack&apos;s binding universe -- not a
            roster verb&apos;s slot, a pipeline stage, or another plugin&apos;s
            skill.
          </Text>
          {orphanNodes.map(node => (
            <OrphanFillRow key={node.fill} node={node} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Scoped to the outline itself (not the app-wide `RouteErrorBoundary`), so a
 * thrown `useComposition` suspense query loses only the tree -- the page
 * title and pack picker (rendered by the caller outside this boundary)
 * survive the fallback and stay usable to switch packs.
 */
class WiringErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <GenericError
          title="This pack's composition failed to load"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function WiringMap() {
  const { text } = useSchemeColors();
  const packsQuery = usePacks();
  const [explicitPack, setExplicitPack] = useState<string | null>(null);
  const [previewVerb, setPreviewVerb] = useState<string | null>(null);

  const packs = packsQuery.data?.packs ?? [];
  const pack = explicitPack ?? packs[0]?.name ?? null;

  return (
    <PageShell
      title="Wiring"
      actions={
        packs.length > 1 && pack ? (
          <Select
            data={packs.map(p => ({ value: p.name, label: p.name }))}
            value={pack}
            onChange={value => {
              setExplicitPack(value);
              setPreviewVerb(null);
            }}
            allowDeselect={false}
            w={200}
            data-testid="pack-select"
          />
        ) : null
      }
    >
      {packsQuery.isError ? (
        <GenericError
          title="Couldn't load skills packs"
          message={(packsQuery.error as Error).message}
          onRetry={() => void packsQuery.refetch()}
        />
      ) : !pack ? (
        packsQuery.isPending ? (
          <Skeleton height={200} data-testid="packs-loading" />
        ) : (
          <Text size="sm" c={text.dimmed} data-testid="no-packs">
            No skills packs found.
          </Text>
        )
      ) : (
        <WiringErrorBoundary key={pack}>
          <LazyLoader>
            <WiringOutline
              pack={pack}
              previewVerb={previewVerb}
              onTogglePreview={setPreviewVerb}
            />
          </LazyLoader>
        </WiringErrorBoundary>
      )}
    </PageShell>
  );
}
