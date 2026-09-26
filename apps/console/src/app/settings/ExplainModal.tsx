import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { rowKind } from '@mattstack/settings-kit/shapes';

import { analyzeChain, shortValue } from '../config/chain';
import { useAgentModels } from '../config/useSettings';
import { useEditorHref } from '../editorHref';
import { DivergedPanel } from './DivergedPanel';
import { DraftEditor } from './DraftEditor';
import { editorKind, formOf } from './formShape';
import { isDiverged, issueText } from './issues';
import { JsonBlock } from './JsonBlock';
import { ScalarControl } from './ScalarControl';
import { ScopeBadge } from './ScopeBadge';
import { SettingRow } from './SettingRow';
import {
  useConsoleSettings,
  useKeyExplain,
  useSettingsRepo,
  type ConsoleStore,
} from './useConsoleSettings';
import { useRowSave, type RowStore } from './useRowSave';
import {
  APPROVAL_KEY,
  EDITOR_KINDS,
  isRung,
  layerLabel,
  repoLabel,
  rungBase,
  type LayerScope,
} from './view';

export type ExplainStore = Pick<
  ConsoleStore,
  'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move' | 'prune'
>;

const MODAL_WIDTH = 760;
const ESCAPE_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]';
// Wide enough for the longest rung label ("machine · repo") without
// truncating: a repo picked always adds a "· repo" suffix to a badge.
const SCOPE_COL = 132;

type Role = 'winner' | 'overridden' | 'contributor' | 'inert';
type Provider = 'claude' | 'codex';

/** Same rule as the Agents section: a provider's `.model` keys suggest
    that provider's model catalog. */
function modelProvider(key: string): Provider | null {
  const m = /^agent\.(claude|codex)\./.exec(key);
  return m && key.endsWith('.model') ? (m[1] as Provider) : null;
}

function Catalog({
  provider,
  children,
}: {
  provider: Provider;
  children: (suggestions?: string[]) => ReactNode;
}) {
  const models = useAgentModels(provider);
  return <>{children((models.data?.models ?? []).map(m => m.value))}</>;
}

function Suggested({
  settingKey,
  children,
}: {
  settingKey: string;
  children: (suggestions?: string[]) => ReactNode;
}) {
  const provider = modelProvider(settingKey);
  return provider ? (
    <Catalog provider={provider}>{children}</Catalog>
  ) : (
    <>{children()}</>
  );
}

/** The def as if `row` were the only layer, so a scalar control edits that
    layer's own value. */
function layerDef(def: SettingDefWire, row: ExplainRowWire): SettingDefWire {
  return {
    ...def,
    effective: {
      scope: row.scope,
      file: row.file,
      ...(row.present ? { value: row.value } : {}),
    },
  };
}

function LayerLine({
  def,
  row,
  role,
  busy,
  onSet,
  onRemove,
  startEditing = false,
  replaceWith,
}: {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: Role;
  busy: boolean;
  onSet: (scope: string, value: unknown) => Promise<boolean>;
  onRemove: (scope: string) => Promise<boolean>;
  startEditing?: boolean;
  replaceWith?: { label: string; value: unknown };
}) {
  const { text } = useSchemeColors();
  const editorHref = useEditorHref();
  const scope = row.scope;
  const store = rungBase(scope);
  const label = store ? layerLabel(scope as LayerScope) : null;
  const allowed = store !== null && def.scopes.includes(store);
  const writable = allowed && def.writable && !def.secret;
  const kind = rowKind(def);
  const edit = editorKind(def);
  const composite = def.type === 'object' || def.type === 'array';
  // console never edits this key here: it is revoked from /settings, not
  // set through a free-text control.
  const editable =
    def.key !== APPROVAL_KEY &&
    writable &&
    (composite ? EDITOR_KINDS.has(edit) : kind === 'scalar' || kind === 'enum');
  // Fix seeds editing open only when the row is editable; a row with no
  // console control keeps Remove as its only remedy.
  const [editing, setEditing] = useState(startEditing && editable);
  const [saved, setSaved] = useState(false);
  // Close on the re-read, not the write, so the old value never flashes.
  useEffect(() => {
    if (!saved) return;
    setSaved(false);
    setEditing(false);
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  let value: ReactNode;
  if (editing && store && !composite)
    value = (
      <Suggested settingKey={def.key}>
        {suggestions => (
          <ScalarControl
            def={layerDef(def, row)}
            writeScope={scope}
            suggestions={suggestions}
            onSave={v =>
              void (v === undefined ? onRemove(scope) : onSet(scope, v)).then(
                ok => ok && setSaved(true)
              )
            }
          />
        )}
      </Suggested>
    );
  else if (!row.present)
    value = (
      <Text fz={12} c={text.muted}>
        not set
      </Text>
    );
  else if (def.secret)
    value = (
      <Text fz={12} c={text.muted}>
        present, never shown here
      </Text>
    );
  else if (composite)
    // A struck-through block is unreadable, so an overridden composite gets
    // only the muted colour, on the wrapper rather than inside JsonBlock.
    value = (
      <Box
        c={role === 'overridden' ? text.muted : undefined}
        data-testid={`layer-value-${scope}`}
      >
        <JsonBlock value={row.value} maxHeight={240} />
      </Box>
    );
  else
    value = (
      <Text
        fz={13}
        ff="monospace"
        truncate
        c={role === 'overridden' ? text.muted : undefined}
        td={role === 'overridden' ? 'line-through' : undefined}
        data-testid={`layer-value-${scope}`}
      >
        {shortValue(row.value)}
      </Text>
    );

  return (
    <Box
      py={10}
      data-testid={`layer-${scope}`}
      style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
    >
      <Group gap={12} wrap="nowrap" mih={28}>
        <Box w={SCOPE_COL} style={{ flex: 'none' }}>
          {store ? (
            <ScopeBadge scope={scope as LayerScope} />
          ) : (
            <Text fz={12} fw={500} c={text.muted}>
              {scope}
            </Text>
          )}
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>{value}</Box>
        <Group gap={6} wrap="nowrap" style={{ flex: 'none' }}>
          {role === 'winner' && (
            <Badge size="sm" variant="light" tt="none" fw={500}>
              wins
            </Badge>
          )}
          {role === 'contributor' && (
            <Badge size="sm" variant="light" tt="none" fw={500}>
              contributes
            </Badge>
          )}
          {row.shadowed && (
            <Badge size="sm" variant="light" color="warn" tt="none" fw={500}>
              ignored, teamLocked
            </Badge>
          )}
          {row.invalid && (
            <Badge size="sm" variant="light" color="bad" tt="none" fw={500}>
              refused
            </Badge>
          )}
        </Group>
        <Group
          gap={4}
          wrap="nowrap"
          w={60}
          justify="flex-end"
          style={{ flex: 'none' }}
        >
          {editable && store && (
            <Tooltip label={editing ? 'Cancel' : `Set at ${label}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                disabled={busy}
                aria-label={
                  editing
                    ? `cancel editing ${def.key} at ${label}`
                    : `set ${def.key} at ${label}`
                }
                onClick={() => setEditing(e => !e)}
              >
                {editing ? <Icons.close size={14} /> : <Icons.edit size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          {writable && store && row.present && (
            <Tooltip label={`Remove from ${label}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                disabled={busy}
                aria-label={`remove ${def.key} from ${label}`}
                onClick={() => void onRemove(scope)}
              >
                <Icons.trash size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Stack gap={2} pl={SCOPE_COL + 12} pt={2}>
        {row.invalid && (
          <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
            {row.invalid}
          </Text>
        )}
        {row.nonconforming?.map((issue, i) => (
          <Text key={i} fz={12} ff="monospace" c="var(--tk-text-warn-small)">
            {issueText(issue)}
          </Text>
        ))}
        {store && !allowed && (
          <Text fz={12} c={text.muted}>
            {`not allowed at this layer (allowed: ${def.scopes.join(', ')})`}
          </Text>
        )}
        {row.file === null ? (
          <Text fz={12} ff="monospace" c={text.dimmed}>
            registry default
          </Text>
        ) : (
          <Anchor
            href={editorHref(row.file)}
            fz={12}
            ff="monospace"
            c={text.dimmed}
            truncate
            aria-label={`open ${row.file}`}
          >
            {row.file}
          </Anchor>
        )}
      </Stack>
      {editing && composite && store && (
        <Box pt={10} pl={SCOPE_COL + 12}>
          <DraftEditor
            def={def}
            form={formOf(def)}
            initial={row.present ? row.value : undefined}
            targetLabel={isRung(scope) ? `${store} · repo` : store}
            saving={busy}
            replaceWith={replaceWith}
            onCancel={() => setEditing(false)}
            onSave={v =>
              onSet(scope, v).then(ok => {
                if (ok) setSaved(true);
                return ok;
              })
            }
          />
        </Box>
      )}
    </Box>
  );
}

function RepoSection({
  settingKey,
  identity,
  onPick,
}: {
  settingKey: string;
  identity: string;
  onPick?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const { rows, loading } = useKeyExplain(settingKey, identity);
  const set = rows.filter(r => r.present && isRung(r.scope));
  return (
    <Box
      py={10}
      data-testid={`repo-${identity}`}
      style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
    >
      <Group gap={12} wrap="nowrap" justify="space-between">
        <Text fz={13} ff="monospace">
          {repoLabel(identity)}
        </Text>
        {onPick && (
          <Button
            size="compact-xs"
            variant="default"
            aria-label={`Show ${repoLabel(identity)}`}
            onClick={() => onPick(identity)}
          >
            Show
          </Button>
        )}
      </Group>
      {loading ? (
        <Skeleton h={28} mt={8} />
      ) : (
        set.map(r => (
          <Stack key={r.scope} gap={4} pt={8}>
            <ScopeBadge scope={r.scope as LayerScope} />
            <JsonBlock value={r.value} />
          </Stack>
        ))
      )}
      {!loading && set.length === 0 && (
        <Text fz={12} c={text.muted} pt={6}>
          no repo section sets it now
        </Text>
      )}
    </Box>
  );
}

function ExplainBody({
  def: storeDef,
  store,
  fix,
  onRead,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: RowStore & Pick<ConsoleStore, 'prune'>;
  fix?: string | null;
  onRead: (at: Date) => void;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const explained = useKeyExplain(storeDef.key, repo);
  const [pruneError, setPruneError] = useState<string | null>(null);
  const { refresh, rows, loading } = explained;
  // A settled explain read is fresher than a store loaded when the page
  // mounted; while a re-read runs, the store already holds the write.
  // settings-kit 0.5.0's /explain route never sets `repos`, `issues` or
  // `mergedIssues` (those come from /defs only), so they are carried over
  // from storeDef regardless of freshness -- otherwise the diverged panel
  // and the modal's own issue lines never render on real data.
  const def =
    !loading && explained.def
      ? {
          ...explained.def,
          repos: explained.def.repos ?? storeDef.repos,
          issues: explained.def.issues ?? storeDef.issues,
          mergedIssues: explained.def.mergedIssues ?? storeDef.mergedIssues,
        }
      : storeDef;
  useEffect(() => {
    if (!loading && rows.length > 0) onRead(new Date());
  }, [loading, rows, onRead]);

  // A failed move can still have written its target, so every settled write
  // re-reads the stack; prune goes through the same path as any other write.
  const tracked: RowStore & Pick<ConsoleStore, 'prune'> = {
    set: async (...a) => after(await store.set(...a)),
    unset: async (...a) => after(await store.unset(...a)),
    move: async (...a) => after(await store.move(...a)),
    prune: async (...a) => after(await store.prune(...a)),
  };
  function after(err: string | null) {
    refresh();
    onChanged?.();
    return err;
  }
  const layers = useRowSave(tracked, def);
  const verdict = rows.length > 0 ? analyzeChain(def, rows) : null;
  const roleOf = (row: ExplainRowWire): Role => {
    if (!verdict) return 'inert';
    if (verdict.kind === 'composite')
      return verdict.contributors.includes(row) ? 'contributor' : 'inert';
    if (verdict.winner === row) return 'winner';
    return verdict.overridden.includes(row) ? 'overridden' : 'inert';
  };
  const diverged = def.secret ? [] : (def.issues ?? []).filter(isDiverged);
  const replaceWithFor = (row: ExplainRowWire) => {
    const issue = diverged.find(d =>
      d.scope !== row.scope ? false : isRung(row.scope) ? d.repo === repo : true
    );
    return issue
      ? { label: 'Use the older value', value: issue.olderValue }
      : undefined;
  };

  return (
    <Stack gap={0}>
      <Suggested settingKey={def.key}>
        {suggestions => (
          <SettingRow
            def={def}
            store={tracked}
            subhead={null}
            query=""
            suggestions={suggestions}
            fullDescription
          />
        )}
      </Suggested>
      <Stack gap={8} pt={20}>
        {verdict && (
          <Text fz={14} data-testid="explain-sentence">
            {verdict.sentence}
          </Text>
        )}
        {verdict?.kind === 'composite' && (
          <Text fz={12} c={text.muted}>
            Deep merge, key by key. Lists replace whole: an array is a leaf,
            never merged.
          </Text>
        )}
        {def.secret && (
          <Alert variant="light" icon={<Icons.warning size={14} />}>
            <Text fz={12}>
              Secret key: the console shows presence and store only. Rotate with{' '}
              <Text span ff="monospace" fz={12}>
                {`rt secrets rotate ${def.key.split('.')[0]} ${def.key.split('.').slice(1).join('.')}`}
              </Text>
              ; the value is prompted, never a CLI argument.
            </Text>
          </Alert>
        )}
      </Stack>
      <Group
        gap={8}
        pt={22}
        pb={6}
        wrap="nowrap"
        style={{ borderBottom: '1px solid var(--tk-line-2)' }}
      >
        <Text fz={12} fw={500} tt="uppercase" lts={0.6} c={text.muted}>
          Layers
        </Text>
        <Text fz={12} c={text.muted}>
          · weakest first, the last set layer wins
        </Text>
      </Group>
      {explained.error ? (
        <Alert color="bad" variant="light" mt="md">
          <Text fz={12}>{explained.error}</Text>
        </Alert>
      ) : rows.length === 0 ? (
        <Stack gap={10} pt={12}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} h={36} />
          ))}
        </Stack>
      ) : (
        rows.map(r => (
          <LayerLine
            key={`${r.scope}:${r.file ?? 'default'}`}
            def={def}
            row={r}
            role={roleOf(r)}
            busy={layers.status === 'saving'}
            onSet={(scope, v) => layers.setAt(scope, v)}
            onRemove={scope => layers.clear(scope)}
            startEditing={r.scope === fix && r.present}
            replaceWith={replaceWithFor(r)}
          />
        ))
      )}
      {layers.error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" pt={8}>
          {layers.error}
        </Text>
      )}
      {diverged.map((issue, i) => (
        <DivergedPanel
          key={i}
          issue={issue}
          onPrune={() => {
            setPruneError(null);
            const base = rungBase(issue.scope)!;
            const op = issue.repo
              ? tracked.prune(def.key, base, issue.storeName, issue.repo)
              : tracked.prune(def.key, base, issue.storeName);
            void op.then(err => err && setPruneError(err));
          }}
        />
      ))}
      {pruneError && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" pt={8}>
          {pruneError}
        </Text>
      )}
      {def.repoScoped && repo === null && (def.repos?.length ?? 0) > 0 && (
        <>
          <Group
            gap={8}
            pt={22}
            pb={6}
            wrap="nowrap"
            style={{ borderBottom: '1px solid var(--tk-line-2)' }}
          >
            <Text fz={12} fw={500} tt="uppercase" lts={0.6} c={text.muted}>
              Repos
            </Text>
            <Text fz={12} c={text.muted}>
              · sections that override every repo's value for one repo
            </Text>
          </Group>
          {def.repos!.map(r => (
            <RepoSection
              key={r.identity}
              settingKey={def.key}
              identity={r.identity}
              onPick={onPickRepo}
            />
          ))}
        </>
      )}
    </Stack>
  );
}

function Resolved({
  settingKey,
  store,
  fix,
  onRead,
  onChanged,
  onPickRepo,
}: {
  settingKey: string;
  store: ExplainStore;
  fix?: string | null;
  onRead: (at: Date) => void;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const def = store.defs.find(d => d.key === settingKey);
  if (def)
    return (
      <ExplainBody
        key={def.key}
        def={def}
        store={store}
        fix={fix}
        onRead={onRead}
        onChanged={onChanged}
        onPickRepo={onPickRepo}
      />
    );
  if (store.error)
    return (
      <Alert color="bad" variant="light">
        <Text fz={12}>{store.error}</Text>
      </Alert>
    );
  if (store.loading)
    return (
      <Stack gap={10}>
        <Skeleton h={48} />
        <Skeleton h={36} />
        <Skeleton h={36} />
      </Stack>
    );
  return (
    <Text fz={14} c={text.muted}>
      {`No setting named ${settingKey} is registered.`}
    </Text>
  );
}

/** Loads just this key, for pages with no settings store of their own. */
function OwnStore(props: {
  settingKey: string;
  fix?: string | null;
  onRead: (at: Date) => void;
  onChanged?: () => void;
}) {
  const store = useConsoleSettings(null, props.settingKey);
  return <Resolved {...props} store={store} />;
}

/** Keeps the last open key through the close transition, so the modal
    fades out with its content instead of emptying first. */
function useLastKey(key: string | null): string | null {
  const last = useRef(key);
  if (key !== null) last.current = key;
  return last.current;
}

/**
 * Why is this value this? The settings row itself, so the value is edited
 * with the same control as on /settings, then the resolver's sentence and
 * every layer, weakest first. With a `store`, writes land in the caller's
 * store and show behind the modal at once; without one it loads the key
 * itself and reports writes through `onChanged`.
 */
export function ExplainModal({
  settingKey,
  store,
  fix,
  onClose,
  onChanged,
  onPickRepo,
}: {
  settingKey: string | null;
  store?: ExplainStore;
  fix?: string | null;
  onClose: () => void;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text, bg } = useSchemeColors();
  const key = useLastKey(settingKey);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const surface = { background: bg.level3 };
  const opened = settingKey !== null;
  // Mantine's own Escape fires first, from any focused field or open menu;
  // there Escape abandons the edit or closes the menu, not the modal.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(ESCAPE_OWNERS)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, onClose]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnEscape={false}
      onExitTransitionEnd={() => setReadAt(null)}
      closeButtonProps={{ 'aria-label': 'Close modal' }}
      size={MODAL_WIDTH}
      padding="lg"
      styles={{
        content: surface,
        header: { ...surface, borderBottom: '1px solid var(--tk-border-soft)' },
      }}
      title={
        <Text span fz={12} c={text.muted}>
          <Text span inherit ff="monospace">
            {`>_ rt settings explain ${key ?? ''}`}
          </Text>
          {readAt && (
            <Text span inherit aria-hidden>
              {` · as of ${readAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            </Text>
          )}
        </Text>
      }
    >
      {key !== null &&
        (store ? (
          <Resolved
            settingKey={key}
            store={store}
            fix={fix}
            onRead={setReadAt}
            onChanged={onChanged}
            onPickRepo={onPickRepo}
          />
        ) : (
          <OwnStore
            settingKey={key}
            fix={fix}
            onRead={setReadAt}
            onChanged={onChanged}
          />
        ))}
    </Modal>
  );
}
