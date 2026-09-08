import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import {
  useSettingsScope,
  type SettingsScopeState,
} from '@mattstack/settings-kit/react';
import { Modal } from '@mattstack/tui-kit';
import type { TabConfig } from '../../config.ts';
import { sectionStatus } from '../../sections.ts';
import { postAction } from '../api.ts';
import {
  addToList,
  COMPOSITE_SHAPES,
  filterDefs,
  formatValue,
  getLeaf,
  groupByScope,
  isSet,
  matchesShape,
  parseScalar,
  rosterSummary,
  rowKind,
  scopeLabel,
  setLeaf,
  slugTabId,
  type CompositeShape,
  type ConfigDef,
  type LeafType,
} from './config-shapes.ts';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';
import { InfoTip } from './InfoTip.tsx';

const SAVED_FLASH_MS = 1400;

function useRowSave(store: SettingsScopeState, def: ConfigDef) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const scope = def.scopes[0] ?? 'user';
  const run = async (op: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await op();
    setBusy(false);
    if (err) {
      setError(err);
      return false;
    }
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    return true;
  };

  return {
    busy,
    error,
    saved,
    setError,
    save: (value: unknown) => run(() => store.set(def.key, scope, value)),
    clear: () => run(() => store.unset(def.key, scope)),
  };
}

/** A text input that commits on blur or Enter and reverts on Escape. Escape
    only stops propagating while the text is dirty, so a clean field still
    lets the modal's own Escape close it. */
function TextField({
  value,
  placeholder,
  ariaLabel,
  disabled,
  list,
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  /** A datalist id for native suggestions. */
  list?: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const dirty = text !== value;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape' && dirty) {
      e.stopPropagation();
      setText(value);
    }
  };

  return (
    <input
      className={'tui-invite-input' + (dirty ? ' dirty' : '')}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      list={list}
      onChange={e => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (dirty) onCommit(text);
      }}
    />
  );
}

function ScalarControl({
  def,
  value,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  row: ReturnType<typeof useRowSave>;
}) {
  if (def.type === 'boolean') {
    return (
      <input
        type="checkbox"
        className="tui-check-box"
        checked={value === true}
        disabled={row.busy}
        aria-label={def.key}
        onChange={e => void row.save(e.target.checked)}
      />
    );
  }
  const type = def.type === 'number' ? 'number' : 'string';
  return (
    <TextField
      value={value === undefined ? '' : String(value)}
      placeholder="unset"
      ariaLabel={def.key}
      disabled={row.busy}
      onCommit={text => {
        const parsed = parseScalar(type, text);
        if (parsed.ok) void row.save(parsed.value);
        else row.setError(parsed.error);
      }}
    />
  );
}

function ChipControl({
  def,
  list,
  row,
}: {
  def: ConfigDef;
  list: string[];
  row: ReturnType<typeof useRowSave>;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const next = addToList(list, draft);
    setDraft('');
    if (next) void row.save(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation();
      setDraft('');
    }
  };
  return (
    <div className="tui-config-chips">
      {list.map((entry, i) => (
        <span key={entry} className="tui-config-chip">
          {entry}
          <button
            aria-label={`remove ${entry} from ${def.key}`}
            disabled={row.busy}
            onClick={() => void row.save(list.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tui-invite-input"
        value={draft}
        placeholder="add…"
        aria-label={`add to ${def.key}`}
        disabled={row.busy}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}

/** One control per declared leaf, editing a copy of the whole object. An
    emptied leaf is removed rather than stored as "" so the reader's own
    fallback (e.g. respond → review cwd) takes over. */
function LeavesControl({
  def,
  value,
  fields,
  row,
}: {
  def: ConfigDef;
  value: unknown;
  fields: Record<string, LeafType>;
  row: ReturnType<typeof useRowSave>;
}) {
  const commit = (path: string, leaf: unknown) =>
    void row.save(setLeaf(value, path, leaf));
  return (
    <div className="tui-config-leaves">
      {Object.entries(fields).map(([path, type]) => {
        const leaf = getLeaf(value, path);
        const label = `${def.key}.${path}`;
        let control;
        if (type === 'boolean') {
          control = (
            <input
              type="checkbox"
              className="tui-check-box"
              checked={leaf === true}
              disabled={row.busy}
              aria-label={label}
              onChange={e => commit(path, e.target.checked)}
            />
          );
        } else if (typeof type === 'object') {
          control = (
            <select
              value={typeof leaf === 'string' ? leaf : ''}
              disabled={row.busy}
              aria-label={label}
              onChange={e =>
                commit(path, e.target.value === '' ? undefined : e.target.value)
              }
            >
              <option value="">unset</option>
              {type.enum.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <TextField
              value={leaf === undefined ? '' : String(leaf)}
              placeholder="unset"
              ariaLabel={label}
              disabled={row.busy}
              onCommit={text => {
                if (text.trim() === '') return commit(path, undefined);
                const parsed = parseScalar(type, text);
                if (parsed.ok) commit(path, parsed.value);
                else row.setError(`${path}: ${parsed.error}`);
              }}
            />
          );
        }
        return (
          <div key={path} className="tui-config-leaf">
            <span className="tui-config-leaf-label">{path}</span>
            {control}
          </div>
        );
      })}
    </div>
  );
}

function PairsControl({
  def,
  pairs,
  fields,
  row,
}: {
  def: ConfigDef;
  pairs: Record<string, string>[];
  fields: readonly [string, string];
  row: ReturnType<typeof useRowSave>;
}) {
  const [a, b] = fields;
  const [draft, setDraft] = useState<{ a: string; b: string }>({
    a: '',
    b: '',
  });
  const addIfComplete = (next: { a: string; b: string }) => {
    setDraft(next);
    if (next.a.trim() === '' || next.b.trim() === '') return;
    setDraft({ a: '', b: '' });
    void row.save([...pairs, { [a]: next.a.trim(), [b]: next.b.trim() }]);
  };
  const update = (i: number, field: string, text: string) =>
    void row.save(pairs.map((p, j) => (j === i ? { ...p, [field]: text } : p)));

  return (
    <div className="tui-config-pairs">
      {pairs.map((p, i) => (
        <div key={i} className="tui-config-pair">
          <TextField
            value={p[a] ?? ''}
            placeholder={a}
            ariaLabel={`${def.key}[${i}].${a}`}
            disabled={row.busy}
            onCommit={t => update(i, a, t)}
          />
          <TextField
            value={p[b] ?? ''}
            placeholder={b}
            ariaLabel={`${def.key}[${i}].${b}`}
            disabled={row.busy}
            onCommit={t => update(i, b, t)}
          />
          <button
            className="tui-config-clear"
            aria-label={`remove ${def.key}[${i}]`}
            disabled={row.busy}
            onClick={() => void row.save(pairs.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="tui-config-pair">
        <TextField
          value={draft.a}
          placeholder={a}
          ariaLabel={`new ${def.key} ${a}`}
          disabled={row.busy}
          onCommit={t => addIfComplete({ ...draft, a: t })}
        />
        <TextField
          value={draft.b}
          placeholder={b}
          ariaLabel={`new ${def.key} ${b}`}
          disabled={row.busy}
          onCommit={t => addIfComplete({ ...draft, b: t })}
        />
        <span />
      </div>
    </div>
  );
}

function CompositeControl({
  def,
  shape,
  value,
  row,
}: {
  def: ConfigDef;
  shape: CompositeShape;
  value: unknown;
  row: ReturnType<typeof useRowSave>;
}) {
  switch (shape.kind) {
    case 'stringList':
      return (
        <ChipControl
          def={def}
          list={Array.isArray(value) ? (value as string[]) : []}
          row={row}
        />
      );
    case 'pairList':
      return (
        <PairsControl
          def={def}
          pairs={
            Array.isArray(value) ? (value as Record<string, string>[]) : []
          }
          fields={shape.fields}
          row={row}
        />
      );
    case 'leaves':
      return (
        <LeavesControl
          def={def}
          value={value}
          fields={shape.fields}
          row={row}
        />
      );
    case 'roster':
      return null;
  }
}

/** The roster row's editor. Roster edits go through POST /roster rather than
    the settings store directly: the server is the single writer that also
    swaps its in-memory roster, so /data.json agrees immediately instead of
    waiting for a restart. It honors the same ownership latch either way.
    Checking people in and out stays in the roster panel, which is what the
    link beside this is for. */
function RosterControl({
  members,
  hidden,
  self,
  onSaved,
  onOpenRoster,
}: {
  members: unknown;
  hidden: unknown;
  /** defaultMember: the board's own identity, which cannot be dropped. */
  self: string | null;
  /** Re-read the store so the list reflects the write. */
  onSaved: () => void;
  onOpenRoster: () => void;
}) {
  const [adding, setAdding] = useState('');
  const [addingName, setAddingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dropping arms on the first click and sends on the second, keyed by
  // username since every row carries the button.
  const [armed, setArmed] = useState<string | null>(null);
  // The username whose display name is being edited inline, if any.
  const [renaming, setRenaming] = useState<string | null>(null);

  const roster = Array.isArray(members)
    ? (members as Array<{
        username?: unknown;
        name?: unknown;
        hidden?: unknown;
      }>)
    : [];
  // Same rule as rosterSummary and withBoardStoreFallback: the user overlay
  // replaces the roster's inline hidden flags rather than adding to them.
  const overlay = Array.isArray(hidden)
    ? (hidden as unknown[]).filter((u): u is string => typeof u === 'string')
    : null;
  const hiddenSet = new Set<string>(
    overlay ??
      roster
        .filter(m => m.hidden === true && typeof m.username === 'string')
        .map(m => m.username as string)
  );

  const edit = async (
    action: 'add' | 'remove' | 'rename',
    username: string,
    name?: string
  ) => {
    setBusy(true);
    setError(null);
    const res = await postAction('/roster', { action, username, name });
    setBusy(false);
    if (!res.ok) {
      setError(res.text || `could not ${action} ${username}`);
      return;
    }
    setArmed(null);
    if (action === 'add') {
      setAdding('');
      setAddingName('');
    }
    setRenaming(null);
    // The write went through /roster (server-validated), so the kit's cached
    // defs are stale until told otherwise.
    onSaved();
  };

  return (
    <div className="tui-roster-edit">
      <div className="tui-roster-head">
        <span className="tui-config-value">
          {rosterSummary(members, hidden)}
        </span>
        <button className="tui-config-link" onClick={onOpenRoster}>
          check people in/out →
        </button>
      </div>
      <ul className="tui-roster-list">
        {roster.map((m, i) => {
          const username = typeof m.username === 'string' ? m.username : '';
          if (!username) return null;
          const name = typeof m.name === 'string' ? m.name : null;
          return (
            <li key={username || i} className="tui-roster-item">
              {renaming === username ? (
                // Clears `renaming` on blur even when TextField's own commit
                // does not fire (blurring with no edit made never calls
                // onCommit), so the row cannot get stuck in edit mode.
                <span
                  className="tui-roster-who"
                  onBlur={() => setRenaming(null)}
                >
                  <TextField
                    value={name ?? ''}
                    placeholder="display name"
                    ariaLabel={`display name for ${username}`}
                    disabled={busy}
                    onCommit={next => void edit('rename', username, next)}
                  />
                </span>
              ) : (
                <span className="tui-roster-who">
                  <button
                    className="tui-config-link"
                    onClick={() => setRenaming(username)}
                    title="set a display name"
                    aria-label={`rename ${username}`}
                  >
                    {name ?? username}
                  </button>
                  {name && <span className="tui-roster-handle">@{username}</span>}
                  {hiddenSet.has(username) && (
                    <span className="tui-roster-out">checked out</span>
                  )}
                </span>
              )}
              {username === self ? (
                <span className="tui-roster-out" title="this board runs as you">
                  you
                </span>
              ) : armed === username ? (
                <button
                  className="tui-modal-btn danger"
                  disabled={busy}
                  onClick={() => void edit('remove', username)}
                >
                  confirm drop
                </button>
              ) : (
                <button
                  className="tui-modal-btn"
                  disabled={busy}
                  onClick={() => setArmed(username)}
                  title="drop from the roster (checking out only hides them)"
                  aria-label={`drop ${username}`}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="tui-roster-add"
        onSubmit={e => {
          e.preventDefault();
          const handle = adding.trim();
          if (handle && !busy) void edit('add', handle, addingName.trim());
        }}
      >
        <input
          className="tui-modal-input"
          value={adding}
          onChange={e => setAdding(e.target.value)}
          placeholder="gitlab username"
          aria-label="add a teammate by gitlab username"
          disabled={busy}
        />
        <input
          className="tui-modal-input"
          value={addingName}
          onChange={e => setAddingName(e.target.value)}
          placeholder="display name (optional)"
          aria-label="display name for the teammate being added"
          disabled={busy}
        />
        <button
          className="tui-modal-btn"
          type="submit"
          disabled={busy || !adding.trim()}
        >
          add
        </button>
      </form>
      {error && <p className="tui-modal-error">{error}</p>}
    </div>
  );
}

type TabSource = TabConfig['source'];

/** Under a tab's section field: the section is not a CODEOWNERS header, and
    the closest one that is. Renders nothing while rt cannot say. */
function SectionHint({
  section,
  known,
}: {
  section: string;
  known: string[] | null;
}) {
  const status = sectionStatus(section, known);
  if (!status.unknown) return null;
  return (
    <p className="tui-modal-error">
      not in CODEOWNERS
      {status.suggestion ? ` · did you mean "${status.suggestion}"?` : ''}
    </p>
  );
}

/** The tabs row's editor. Edits go through POST /tabs for the same reason
    roster edits go through /roster: the server validates the whole list and
    swaps its in-memory copy, so the board re-declares the new sections to rt
    at once instead of on the next restart. `tabs` is the effective list from
    /data.json, which is right whichever side of the ownership latch owns it. */
function TabsControl({
  tabs,
  defaultChannel,
  knownSections,
  onSaved,
}: {
  tabs: TabConfig[];
  /** board.slack.channel, what a tab without its own slackChannel inherits. */
  defaultChannel: string | null;
  /** Drives the section field's suggestions and the not-in-CODEOWNERS hint. */
  knownSections: string[] | null;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dropping a tab discards its config, so the armed row demands the tab's
  // label typed back before the drop button enables.
  const [armed, setArmed] = useState<string | null>(null);
  const [dropText, setDropText] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<TabSource['kind']>('codeowners');
  const [newSection, setNewSection] = useState('');
  const sectionListId = useId();

  const write = async (next: TabConfig[]) => {
    setBusy(true);
    setError(null);
    const res = await postAction('/tabs', { tabs: next });
    setBusy(false);
    if (!res.ok) {
      setError(res.text || 'could not save tabs');
      return false;
    }
    setArmed(null);
    setDropText('');
    onSaved();
    return true;
  };

  const arm = (id: string | null) => {
    setArmed(id);
    setDropText('');
  };

  const patch = (id: string, change: (tab: TabConfig) => TabConfig) =>
    void write(tabs.map(t => (t.id === id ? change(t) : t)));
  const optional = (text: string) =>
    text.trim() === '' ? undefined : text.trim();

  const add = async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    const source: TabSource =
      newKind === 'authors'
        ? { kind: 'authors' }
        : {
            kind: 'codeowners',
            section: newSection.trim(),
            excludeMembers: true,
          };
    const ok = await write([
      ...tabs,
      {
        id: slugTabId(
          label,
          tabs.map(t => t.id)
        ),
        label,
        source,
      },
    ]);
    if (ok) {
      setNewLabel('');
      setNewSection('');
    }
  };

  return (
    <div className="tui-roster-edit">
      <datalist id={sectionListId}>
        {(knownSections ?? []).map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <ul className="tui-roster-list tui-tabs-list">
        {tabs.map(tab => (
          <li key={tab.id} className="tui-tabs-item">
            <div className="tui-tabs-item-head">
              <TextField
                value={tab.label}
                placeholder="label"
                ariaLabel={`label for tab ${tab.id}`}
                disabled={busy}
                onCommit={text =>
                  patch(tab.id, t => ({ ...t, label: text.trim() }))
                }
              />
              <span className="tui-roster-handle">{tab.source.kind}</span>
              {tabs.length === 1 ? (
                <span
                  className="tui-roster-out"
                  title="the board needs at least one tab"
                >
                  only tab
                </span>
              ) : armed === tab.id ? (
                <button
                  className="tui-modal-btn"
                  disabled={busy}
                  onClick={() => arm(null)}
                >
                  cancel
                </button>
              ) : (
                <button
                  className="tui-modal-btn"
                  disabled={busy}
                  onClick={() => arm(tab.id)}
                  title="drop this tab"
                  aria-label={`drop tab ${tab.id}`}
                >
                  ✕
                </button>
              )}
            </div>
            {armed === tab.id && (
              <form
                className="tui-tabs-drop"
                onSubmit={e => {
                  e.preventDefault();
                  if (dropText === tab.label && !busy)
                    void write(tabs.filter(t => t.id !== tab.id));
                }}
              >
                <span className="tui-modal-error">
                  dropping this tab discards its section, channel, and skill
                  settings
                </span>
                <input
                  className="tui-modal-input"
                  autoFocus
                  value={dropText}
                  onChange={e => setDropText(e.target.value)}
                  placeholder={`type ${tab.label} to confirm`}
                  aria-label={`type the label of tab ${tab.id} to confirm dropping it`}
                  disabled={busy}
                />
                <button
                  className="tui-modal-btn danger"
                  type="submit"
                  disabled={busy || dropText !== tab.label}
                >
                  drop tab
                </button>
              </form>
            )}
            <div className="tui-tabs-fields">
              {tab.source.kind === 'codeowners' && (
                <>
                  <label className="tui-tabs-field">
                    <span>section</span>
                    <TextField
                      value={tab.source.section}
                      placeholder="CODEOWNERS section"
                      ariaLabel={`codeowners section for tab ${tab.id}`}
                      disabled={busy}
                      list={sectionListId}
                      onCommit={text =>
                        patch(tab.id, t => ({
                          ...t,
                          source: {
                            ...(t.source as Extract<
                              TabSource,
                              { kind: 'codeowners' }
                            >),
                            section: text.trim(),
                          },
                        }))
                      }
                    />
                  </label>
                  <SectionHint
                    section={tab.source.section}
                    known={knownSections}
                  />
                  <label className="tui-tabs-field tui-tabs-check">
                    <input
                      type="checkbox"
                      className="tui-check-box"
                      checked={tab.source.excludeMembers === true}
                      disabled={busy}
                      onChange={e =>
                        patch(tab.id, t => ({
                          ...t,
                          source: {
                            ...(t.source as Extract<
                              TabSource,
                              { kind: 'codeowners' }
                            >),
                            excludeMembers: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>hide roster authors (they have their own tab)</span>
                  </label>
                </>
              )}
              <label className="tui-tabs-field">
                <span>slack channel</span>
                <TextField
                  value={tab.slackChannel ?? ''}
                  placeholder={
                    defaultChannel
                      ? `inherits board.slack: #${defaultChannel}`
                      : 'inherits board.slack.channel'
                  }
                  ariaLabel={`slack channel for tab ${tab.id}`}
                  disabled={busy}
                  onCommit={text =>
                    patch(tab.id, t => ({
                      ...t,
                      slackChannel: optional(text),
                    }))
                  }
                />
              </label>
              <label className="tui-tabs-field">
                <span>review skill</span>
                <TextField
                  value={tab.reviewSkill ?? ''}
                  placeholder="inherits the repo's review skill"
                  ariaLabel={`review skill for tab ${tab.id}`}
                  disabled={busy}
                  onCommit={text =>
                    patch(tab.id, t => ({
                      ...t,
                      reviewSkill: optional(text),
                    }))
                  }
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="tui-roster-add tui-tabs-add"
        onSubmit={e => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="tui-modal-input"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          placeholder="new tab label"
          aria-label="new tab label"
          disabled={busy}
        />
        <select
          className="tui-modal-input tui-tabs-kind"
          value={newKind}
          aria-label="new tab source"
          disabled={busy}
          onChange={e => setNewKind(e.target.value as TabSource['kind'])}
        >
          <option value="codeowners">codeowners</option>
          <option value="authors">authors</option>
        </select>
        {newKind === 'codeowners' && (
          <input
            className="tui-modal-input"
            value={newSection}
            onChange={e => setNewSection(e.target.value)}
            placeholder="CODEOWNERS section"
            aria-label="new tab codeowners section"
            disabled={busy}
            list={sectionListId}
          />
        )}
        <button
          className="tui-modal-btn"
          type="submit"
          disabled={
            busy ||
            !newLabel.trim() ||
            (newKind === 'codeowners' && !newSection.trim())
          }
        >
          add tab
        </button>
      </form>
      {error && <p className="tui-modal-error">{error}</p>}
    </div>
  );
}

/** Control-specific caveats the registry description cannot know, shown in
    the same info tip as the description. */
const ROW_HINTS: Record<string, string> = {
  'board.members': "A new teammate's MRs land once rt has synced them.",
  'board.tabs':
    'A new section\'s MRs land once rt has backfilled it; the tab shows "syncing" until then. A section must match a CODEOWNERS header exactly; the field suggests the headers rt has seen.',
};

const OPEN_ROWS_KEY = 'board.config.openRows';

/** Which composite rows are expanded, remembered per browser so the modal
    reopens the way it was left. Storage is a convenience only: any failure
    reads as "all collapsed". */
function useOpenRows(): [Set<string>, (key: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(OPEN_ROWS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((k): k is string => typeof k === 'string')
          : []
      );
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_ROWS_KEY, JSON.stringify([...open]));
    } catch {
      // storage unavailable: the open set still works for this mount
    }
  }, [open]);
  return [open, toggle];
}

function SettingRow({
  def,
  store,
  tabs,
  knownSections,
  open,
  onToggle,
  onOpenRoster,
  onTabsSaved,
}: {
  def: ConfigDef;
  store: SettingsScopeState;
  tabs: TabConfig[];
  knownSections: string[] | null;
  /** Expanded, for a collapsible row; ignored otherwise. */
  open: boolean;
  onToggle: () => void;
  onOpenRoster: () => void;
  onTabsSaved: () => void;
}) {
  const kind = rowKind(def);
  const row = useRowSave(store, def);
  const value = def.effective.value;
  const shape = COMPOSITE_SHAPES[def.key];
  const set = isSet(def);
  const malformed =
    shape !== undefined &&
    shape.kind !== 'roster' &&
    value !== undefined &&
    !matchesShape(shape, value);

  let control;
  if (kind === 'tabs' && !malformed) {
    const channel = getLeaf(
      store.defs.find(d => d.key === 'board.slack')?.effective.value,
      'channel'
    );
    control = (
      <TabsControl
        tabs={tabs}
        defaultChannel={
          typeof channel === 'string' && channel !== '' ? channel : null
        }
        knownSections={knownSections}
        onSaved={() => {
          store.refresh();
          onTabsSaved();
        }}
      />
    );
  } else if (kind === 'roster') {
    const members = store.defs.find(d => d.key === 'board.members')?.effective
      .value;
    const hidden = store.defs.find(d => d.key === 'board.hiddenMembers')
      ?.effective.value;
    const self = store.defs.find(d => d.key === 'board.defaultMember')
      ?.effective.value;
    control =
      def.key === 'board.members' ? (
        <RosterControl
          members={members}
          hidden={hidden}
          self={typeof self === 'string' ? self : null}
          onSaved={store.refresh}
          onOpenRoster={onOpenRoster}
        />
      ) : (
        <>
          <span className="tui-config-value">
            {rosterSummary(members, hidden)}
          </span>
          <button className="tui-config-link" onClick={onOpenRoster}>
            check people in/out →
          </button>
        </>
      );
  } else if (def.secret) {
    control = (
      <span className="tui-config-value">
        {def.effective.scope ? '•••' : 'unset'}
      </span>
    );
  } else if (kind === 'readonly' || malformed) {
    control = (
      <span className="tui-config-value">
        {value === undefined ? 'unset' : formatValue(value)}
        {malformed && (
          <span className="tui-config-flag">
            unexpected shape — clear it or fix the store file
          </span>
        )}
      </span>
    );
  } else if (kind === 'scalar') {
    control = <ScalarControl def={def} value={value} row={row} />;
  } else {
    control = (
      <CompositeControl def={def} shape={shape!} value={value} row={row} />
    );
  }

  const help = [def.description, ROW_HINTS[def.key]]
    .filter(Boolean)
    .join('\n\n');
  // Only rows whose control is a block of fields collapse; a single input,
  // a readonly value, or the hidden-members pointer is already one line.
  const collapsible =
    shape !== undefined &&
    !malformed &&
    !def.secret &&
    kind !== 'readonly' &&
    def.key !== 'board.hiddenMembers';
  const body = (
    <>
      <div className="tui-config-control">
        {control}
        <span className={'tui-config-status' + (row.busy ? ' busy' : '')}>
          {row.busy ? 'saving…' : row.saved ? 'saved ✓' : ''}
        </span>
      </div>
      {row.error && <p className="tui-config-error">{row.error}</p>}
      {def.effective.invalid && (
        <p className="tui-config-error">
          stored value rejected: {def.effective.invalid}
        </p>
      )}
    </>
  );

  // Inside a collapsible head these must not toggle the row.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const head = (
    <>
      <span className="tui-config-keyname">{def.key}</span>
      <span onClick={stop} onKeyDown={stop} className="tui-config-tip">
        <InfoTip text={help} about={def.key} />
      </span>
      <span className="tui-config-badge">
        {def.secret ? 'secret' : scopeLabel(def.scopes[0] ?? 'user')}
      </span>
      {set && kind !== 'roster' && kind !== 'tabs' && (
        <button
          className="tui-config-clear"
          title="clear from store"
          aria-label={`clear ${def.key}`}
          disabled={row.busy}
          onClick={e => {
            e.stopPropagation();
            void row.clear();
          }}
          onKeyDown={stop}
        >
          ↺
        </button>
      )}
    </>
  );

  return (
    <li
      className={
        'tui-config-row' +
        (set ? ' set' : '') +
        (collapsible ? ' collapsible' : '')
      }
      data-key={def.key}
    >
      {collapsible ? (
        <DisclosureHead
          open={open}
          label={def.key}
          onToggle={onToggle}
          className="tui-config-head"
        >
          {head}
        </DisclosureHead>
      ) : (
        <div className="tui-config-head">{head}</div>
      )}
      {collapsible ? <Disclosure open={open}>{body}</Disclosure> : body}
    </li>
  );
}

/** The board's store-backed settings as one flat, filterable list where
    every row is its own control and saves on blur — no staging. Grouped by
    the single scope each board.* key allows. Distinct from SettingsModal,
    which manages the team roster and owns the two roster keys shown here
    read-only. */
function ConfigModal({
  tabs,
  knownSections,
  onClose,
  onOpenRoster,
  onTabsSaved,
}: {
  /** Effective tabs from /data.json: the editor's base whichever side owns them. */
  tabs: TabConfig[];
  /** Section headers rt saw in the projects' CODEOWNERS; null when rt did not report them. */
  knownSections: string[] | null;
  onClose: () => void;
  onOpenRoster: () => void;
  /** Reload board data so the new tab strip lands without waiting for a poll. */
  onTabsSaved: () => void;
}) {
  const store = useSettingsScope('board.');
  const [query, setQuery] = useState('');
  const [openRows, toggleRow] = useOpenRows();
  const groups = groupByScope(filterDefs(store.defs, query));

  return (
    <Modal
      title="❯ board settings"
      ariaLabel="board settings"
      onClose={onClose}
      closeGlyph="✕"
      className="tui-config-modal"
    >
      <input
        className="tui-invite-input tui-config-filter"
        autoFocus
        value={query}
        placeholder="filter settings"
        aria-label="filter settings"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && query !== '') {
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      {store.loading && <p className="tui-modal-sub">loading…</p>}
      {store.error && <p className="tui-config-error">{store.error}</p>}
      <div className="tui-config-body">
        {groups.map(g => (
          <section key={g.scope}>
            <h3 className="tui-config-group">{g.scope}</h3>
            <ul className="tui-config-list">
              {g.defs.map(def => (
                <SettingRow
                  key={def.key}
                  def={def}
                  store={store}
                  tabs={tabs}
                  knownSections={knownSections}
                  open={openRows.has(def.key)}
                  onToggle={() => toggleRow(def.key)}
                  onOpenRoster={onOpenRoster}
                  onTabsSaved={onTabsSaved}
                />
              ))}
            </ul>
          </section>
        ))}
        {!store.loading && !store.error && groups.length === 0 && (
          <p className="tui-modal-sub">no settings match</p>
        )}
      </div>
    </Modal>
  );
}

export { ConfigModal };
