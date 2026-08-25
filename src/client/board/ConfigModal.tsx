import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Modal } from "@mattstack/tui-kit";
import { useSettingsScope, type SettingsScopeState } from "@mattstack/settings-kit/react";
import {
  COMPOSITE_SHAPES,
  addToList,
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
  type CompositeShape,
  type ConfigDef,
  type LeafType,
} from "./config-shapes.ts";

/** The scope hook plus 0.1.2's `unset`, feature-detected so ↺ simply stays
    hidden on a kit without it. */
type ConfigStore = SettingsScopeState & { unset?: (key: string, scope: string) => Promise<string | null> };

const SAVED_FLASH_MS = 1400;

function useRowSave(store: ConfigStore, def: ConfigDef) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const scope = def.scopes[0] ?? "user";
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
    clear: store.unset ? () => run(() => store.unset!(def.key, scope)) : undefined,
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
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const dirty = text !== value;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape" && dirty) {
      e.stopPropagation();
      setText(value);
    }
  };

  return (
    <input
      className={"tui-invite-input" + (dirty ? " dirty" : "")}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (dirty) onCommit(text);
      }}
    />
  );
}

function ScalarControl({ def, value, row }: { def: ConfigDef; value: unknown; row: ReturnType<typeof useRowSave> }) {
  if (def.type === "boolean") {
    return (
      <input
        type="checkbox"
        className="tui-check-box"
        checked={value === true}
        disabled={row.busy}
        aria-label={def.key}
        onChange={(e) => void row.save(e.target.checked)}
      />
    );
  }
  const type = def.type === "number" ? "number" : "string";
  return (
    <TextField
      value={value === undefined ? "" : String(value)}
      placeholder="unset"
      ariaLabel={def.key}
      disabled={row.busy}
      onCommit={(text) => {
        const parsed = parseScalar(type, text);
        if (parsed.ok) void row.save(parsed.value);
        else row.setError(parsed.error);
      }}
    />
  );
}

function ChipControl({ def, list, row }: { def: ConfigDef; list: string[]; row: ReturnType<typeof useRowSave> }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = addToList(list, draft);
    setDraft("");
    if (next) void row.save(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Escape" && draft !== "") {
      e.stopPropagation();
      setDraft("");
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
        onChange={(e) => setDraft(e.target.value)}
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
  const commit = (path: string, leaf: unknown) => void row.save(setLeaf(value, path, leaf));
  return (
    <div className="tui-config-leaves">
      {Object.entries(fields).map(([path, type]) => {
        const leaf = getLeaf(value, path);
        const label = `${def.key}.${path}`;
        let control;
        if (type === "boolean") {
          control = (
            <input
              type="checkbox"
              className="tui-check-box"
              checked={leaf === true}
              disabled={row.busy}
              aria-label={label}
              onChange={(e) => commit(path, e.target.checked)}
            />
          );
        } else if (typeof type === "object") {
          control = (
            <select
              value={typeof leaf === "string" ? leaf : ""}
              disabled={row.busy}
              aria-label={label}
              onChange={(e) => commit(path, e.target.value === "" ? undefined : e.target.value)}
            >
              <option value="">unset</option>
              {type.enum.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <TextField
              value={leaf === undefined ? "" : String(leaf)}
              placeholder="unset"
              ariaLabel={label}
              disabled={row.busy}
              onCommit={(text) => {
                if (text.trim() === "") return commit(path, undefined);
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
  const [draft, setDraft] = useState<{ a: string; b: string }>({ a: "", b: "" });
  const addIfComplete = (next: { a: string; b: string }) => {
    setDraft(next);
    if (next.a.trim() === "" || next.b.trim() === "") return;
    setDraft({ a: "", b: "" });
    void row.save([...pairs, { [a]: next.a.trim(), [b]: next.b.trim() }]);
  };
  const update = (i: number, field: string, text: string) =>
    void row.save(pairs.map((p, j) => (j === i ? { ...p, [field]: text } : p)));

  return (
    <div className="tui-config-pairs">
      {pairs.map((p, i) => (
        <div key={i} className="tui-config-pair">
          <TextField value={p[a] ?? ""} placeholder={a} ariaLabel={`${def.key}[${i}].${a}`} disabled={row.busy} onCommit={(t) => update(i, a, t)} />
          <TextField value={p[b] ?? ""} placeholder={b} ariaLabel={`${def.key}[${i}].${b}`} disabled={row.busy} onCommit={(t) => update(i, b, t)} />
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
        <TextField value={draft.a} placeholder={a} ariaLabel={`new ${def.key} ${a}`} disabled={row.busy} onCommit={(t) => addIfComplete({ ...draft, a: t })} />
        <TextField value={draft.b} placeholder={b} ariaLabel={`new ${def.key} ${b}`} disabled={row.busy} onCommit={(t) => addIfComplete({ ...draft, b: t })} />
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
    case "stringList":
      return <ChipControl def={def} list={Array.isArray(value) ? (value as string[]) : []} row={row} />;
    case "pairList":
      return <PairsControl def={def} pairs={Array.isArray(value) ? (value as Record<string, string>[]) : []} fields={shape.fields} row={row} />;
    case "leaves":
      return <LeavesControl def={def} value={value} fields={shape.fields} row={row} />;
    case "roster":
      return null;
  }
}

function SettingRow({ def, store, onOpenRoster }: { def: ConfigDef; store: ConfigStore; onOpenRoster: () => void }) {
  const kind = rowKind(def);
  const row = useRowSave(store, def);
  const value = def.effective.value;
  const shape = COMPOSITE_SHAPES[def.key];
  const set = isSet(def);
  const malformed = shape !== undefined && shape.kind !== "roster" && value !== undefined && !matchesShape(shape, value);

  let control;
  if (kind === "roster") {
    const members = store.defs.find((d) => d.key === "board.members")?.effective.value;
    const hidden = store.defs.find((d) => d.key === "board.hiddenMembers")?.effective.value;
    control = (
      <>
        <span className="tui-config-value">{rosterSummary(members, hidden)}</span>
        <button className="tui-config-link" onClick={onOpenRoster}>
          manage in roster →
        </button>
      </>
    );
  } else if (def.secret) {
    control = <span className="tui-config-value">{def.effective.scope ? "•••" : "unset"}</span>;
  } else if (kind === "readonly" || malformed) {
    control = (
      <span className="tui-config-value">
        {value === undefined ? "unset" : formatValue(value)}
        {malformed && <span className="tui-config-flag">unexpected shape — clear it or fix the store file</span>}
      </span>
    );
  } else if (kind === "scalar") {
    control = <ScalarControl def={def} value={value} row={row} />;
  } else {
    control = <CompositeControl def={def} shape={shape!} value={value} row={row} />;
  }

  return (
    <li className={"tui-config-row" + (set ? " set" : "")} data-key={def.key}>
      <div className="tui-config-head">
        <span className="tui-config-keyname">{def.key}</span>
        <span className="tui-config-badge">{def.secret ? "secret" : scopeLabel(def.scopes[0] ?? "user")}</span>
        {set && row.clear && kind !== "roster" && (
          <button className="tui-config-clear" title="clear from store" aria-label={`clear ${def.key}`} disabled={row.busy} onClick={() => void row.clear!()}>
            ↺
          </button>
        )}
      </div>
      <p className="tui-config-desc">{def.description}</p>
      <div className="tui-config-control">
        {control}
        <span className={"tui-config-status" + (row.busy ? " busy" : "")}>{row.busy ? "saving…" : row.saved ? "saved ✓" : ""}</span>
      </div>
      {row.error && <p className="tui-config-error">{row.error}</p>}
      {def.effective.invalid && <p className="tui-config-error">stored value rejected: {def.effective.invalid}</p>}
    </li>
  );
}

/** The board's store-backed settings as one flat, filterable list where
    every row is its own control and saves on blur — no staging. Grouped by
    the single scope each board.* key allows. Distinct from SettingsModal,
    which manages the team roster and owns the two roster keys shown here
    read-only. */
function ConfigModal({ onClose, onOpenRoster }: { onClose: () => void; onOpenRoster: () => void }) {
  const store: ConfigStore = useSettingsScope("board.");
  const [query, setQuery] = useState("");
  const groups = groupByScope(filterDefs(store.defs, query));

  return (
    <Modal title="❯ board settings" ariaLabel="board settings" onClose={onClose} closeGlyph="✕" className="tui-config-modal">
      <input
        className="tui-invite-input tui-config-filter"
        autoFocus
        value={query}
        placeholder="filter settings"
        aria-label="filter settings"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query !== "") {
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      {store.loading && <p className="tui-modal-sub">loading…</p>}
      {store.error && <p className="tui-config-error">{store.error}</p>}
      {groups.map((g) => (
        <section key={g.scope}>
          <h3 className="tui-config-group">{g.scope}</h3>
          <ul className="tui-config-list">
            {g.defs.map((def) => (
              <SettingRow key={def.key} def={def} store={store} onOpenRoster={onOpenRoster} />
            ))}
          </ul>
        </section>
      ))}
      {!store.loading && !store.error && groups.length === 0 && <p className="tui-modal-sub">no settings match</p>}
    </Modal>
  );
}

export { ConfigModal };
