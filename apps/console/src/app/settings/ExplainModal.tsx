import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import {
  useSettingKey,
  useSettingsScope,
  type ExplainRowWire,
  type SettingDefWire,
  type SettingsScopeState,
} from '@mattstack/settings-kit/react';
import { rowKind } from '@mattstack/settings-kit/shapes';

import { analyzeChain, shortValue } from '../config/chain';
import { useAgentModels } from '../config/useSettings';
import { useEditorHref } from '../editorHref';
import { ScalarControl } from './ScalarControl';
import { ScopeBadge } from './ScopeBadge';
import { SettingRow } from './SettingRow';
import { useRowSave, type RowStore } from './useRowSave';
import { isStoreScope, type StoreScope } from './view';

export type ExplainStore = Pick<
  SettingsScopeState,
  'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move'
>;

const MODAL_WIDTH = 760;
const ESCAPE_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]';
const SCOPE_COL = 88;

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
}: {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: Role;
  busy: boolean;
  onSet: (scope: StoreScope, value: unknown) => Promise<boolean>;
  onRemove: (scope: StoreScope) => Promise<boolean>;
}) {
  const { text } = useSchemeColors();
  const editorHref = useEditorHref();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Close on the re-read, not the write, so the old value never flashes.
  useEffect(() => {
    if (!saved) return;
    setSaved(false);
    setEditing(false);
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const scope = row.scope;
  const store = isStoreScope(scope) ? scope : null;
  const allowed = store !== null && def.scopes.includes(store);
  const writable = allowed && def.writable && !def.secret;
  const kind = rowKind(def);
  const editable = writable && (kind === 'scalar' || kind === 'enum');

  let value: ReactNode;
  if (editing && store)
    value = (
      <Suggested settingKey={def.key}>
        {suggestions => (
          <ScalarControl
            def={layerDef(def, row)}
            suggestions={suggestions}
            onSave={v =>
              void (v === undefined ? onRemove(store) : onSet(store, v)).then(
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
            <ScopeBadge scope={store} />
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
            <Tooltip label={editing ? 'Cancel' : `Set at ${store}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                disabled={busy}
                aria-label={
                  editing
                    ? `cancel editing ${def.key} at ${store}`
                    : `set ${def.key} at ${store}`
                }
                onClick={() => setEditing(e => !e)}
              >
                {editing ? <Icons.close size={14} /> : <Icons.edit size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          {writable && store && row.present && (
            <Tooltip label={`Remove from ${store}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                disabled={busy}
                aria-label={`remove ${def.key} from ${store}`}
                onClick={() => void onRemove(store)}
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
    </Box>
  );
}

function ExplainBody({
  def: storeDef,
  store,
  onRead,
  onChanged,
}: {
  def: SettingDefWire;
  store: RowStore;
  onRead: (at: Date) => void;
  onChanged?: () => void;
}) {
  const { text } = useSchemeColors();
  const explained = useSettingKey(storeDef.key);
  const { refresh, rows, loading } = explained;
  // A settled explain read is fresher than a store loaded when the page
  // mounted; while a re-read runs, the store already holds the write.
  const def = !loading && explained.def ? explained.def : storeDef;
  useEffect(() => {
    if (!loading && rows.length > 0) onRead(new Date());
  }, [loading, rows, onRead]);

  // A failed move can still have written its target, so every settled write
  // re-reads the stack.
  const tracked: RowStore = {
    set: async (...a) => after(await store.set(...a)),
    unset: async (...a) => after(await store.unset(...a)),
    move: async (...a) => after(await store.move(...a)),
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
          />
        ))
      )}
      {layers.error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" pt={8}>
          {layers.error}
        </Text>
      )}
    </Stack>
  );
}

function Resolved({
  settingKey,
  store,
  onRead,
  onChanged,
}: {
  settingKey: string;
  store: ExplainStore;
  onRead: (at: Date) => void;
  onChanged?: () => void;
}) {
  const { text } = useSchemeColors();
  const def = store.defs.find(d => d.key === settingKey);
  if (def)
    return (
      <ExplainBody
        key={def.key}
        def={def}
        store={store}
        onRead={onRead}
        onChanged={onChanged}
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
  onRead: (at: Date) => void;
  onChanged?: () => void;
}) {
  const store = useSettingsScope(props.settingKey);
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
  onClose,
  onChanged,
}: {
  settingKey: string | null;
  store?: ExplainStore;
  onClose: () => void;
  onChanged?: () => void;
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
            onRead={setReadAt}
            onChanged={onChanged}
          />
        ) : (
          <OwnStore settingKey={key} onRead={setReadAt} onChanged={onChanged} />
        ))}
    </Modal>
  );
}
