import { useState } from "react";
import { Modal } from "@mattstack/tui-kit";
import { useSettingsScope, useSettingKey, type SettingDefWire } from "@mattstack/settings-kit/react";

/** One key's layer stack + staged edit. Values render as JSON; input parses
    as JSON first and falls back to a bare string so plain text needs no
    quoting. The server's guard ladder is the authority — its message renders
    verbatim on a failed apply. */
function KeyEditor({ def }: { def: SettingDefWire }) {
  const key = useSettingKey(def.key);
  const [scope, setScope] = useState<string>(def.scopes[0] ?? "user");
  const [input, setInput] = useState("");

  const stageFromInput = () => {
    let value: unknown = input;
    try {
      value = JSON.parse(input);
    } catch {
      // bare string
    }
    key.stage(scope, value);
  };

  if (key.loading) return <p className="tui-modal-sub">loading…</p>;
  if (key.error) return <p className="tui-config-error">{key.error}</p>;

  return (
    <div className="tui-config-editor">
      <table className="tui-config-rows">
        <tbody>
          {key.rows.map((row) => (
            <tr key={row.scope} className={row.present ? undefined : "tui-config-absent"}>
              <td className="tui-config-scope">{row.scope}</td>
              <td className="tui-config-value">
                {row.present ? ("value" in row ? JSON.stringify(row.value) : "•••") : "—"}
                {row.shadowed ? " (shadowed)" : ""}
                {row.invalid ? ` (invalid: ${row.invalid})` : ""}
              </td>
              <td className="tui-config-file" title={row.file ?? "registry default"}>
                {row.file === null ? "default" : row.file.split("/").slice(-2).join("/")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {def.writable ? (
        <div className="tui-config-edit-row">
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={`scope for ${def.key}`}>
            {def.scopes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="tui-invite-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`${def.type} value`}
            aria-label={`new value for ${def.key}`}
          />
          {key.staged === undefined ? (
            <button className="tui-invite-btn" onClick={stageFromInput} disabled={input === ""}>stage</button>
          ) : (
            <>
              <button className="tui-invite-btn" onClick={() => void key.apply()} disabled={key.applying}>
                {key.applying ? "applying…" : `apply to ${key.staged.scope}`}
              </button>
              <button className="tui-invite-btn" onClick={key.reset} disabled={key.applying}>discard</button>
            </>
          )}
        </div>
      ) : (
        <p className="tui-modal-sub">read-only here{def.secret ? " (secret)" : ""}</p>
      )}
      {key.applyError && <p className="tui-config-error">{key.applyError}</p>}
      {key.staged !== undefined && (
        <p className="tui-modal-sub">
          {key.staged.scope === "machine"
            ? "machine edits apply immediately"
            : `${key.staged.scope} edits stay local until the home repo is pushed`}
        </p>
      )}
    </div>
  );
}

/** The board's store-backed settings, viewable and editable in place — every
    `board.*` key from the suite registry. Headless settings-kit hooks carry
    all state; this file is only the board-flavored rendering. Distinct from
    SettingsModal, which manages the team roster. */
function ConfigModal({ onClose }: { onClose: () => void }) {
  const scope = useSettingsScope("board.");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Modal title="❯ board settings" ariaLabel="board settings" onClose={onClose} closeGlyph="✕">
      {scope.loading && <p className="tui-modal-sub">loading…</p>}
      {scope.error && <p className="tui-config-error">{scope.error}</p>}
      <ul className="tui-modal-list tui-config-keys">
        {scope.defs.map((def) => (
          <li key={def.key} className="tui-config-key-row">
            <button
              className="tui-config-key"
              onClick={() => setOpen(open === def.key ? null : def.key)}
              aria-expanded={open === def.key}
            >
              <span className="tui-config-keyname">{open === def.key ? "▾" : "▸"} {def.key}</span>
              <span className="tui-modal-sub">{def.description}</span>
            </button>
            {open === def.key && <KeyEditor def={def} />}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export { ConfigModal };
