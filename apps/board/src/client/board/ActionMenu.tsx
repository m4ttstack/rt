import { Fragment, useEffect, useState } from 'react';

import { ContextMenu } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import {
  AgentGlyph,
  ArrowOutGlyph,
  FlagGlyph,
  MenuGlyph,
  SlackLogo,
} from './icons.tsx';
import type {
  ActionGlyph,
  Lane,
  MenuEntry,
  RunOpts,
  Section,
} from './row-actions.ts';

const SECTIONS: Array<[Section, string]> = [
  ['agent', 'agent actions'],
  ['gitlab', 'gitlab'],
  ['slack', 'slack'],
];

function glyphNode(g: ActionGlyph): React.ReactNode {
  switch (g.kind) {
    case 'menu':
      return <MenuGlyph kind={g.name} />;
    case 'flag':
      return <FlagGlyph kind={g.name} />;
    case 'out':
      return <ArrowOutGlyph />;
    case 'slack':
      return <SlackLogo />;
    case 'emoji':
      return <span className="tui-menu-emoji">{g.glyph}</span>;
  }
}

/** An agent action's label: the bot mark in the lane's color, then the
    row's own verb, so the menu and the status line say the same thing. */
function agentLabel(lane: Lane, text: string) {
  return (
    <span className="tui-menu-agent" data-lane={lane}>
      <AgentGlyph />
      {text}
    </span>
  );
}

function iconLabel(icon: React.ReactNode, text: string) {
  return (
    <span className="tui-menu-icon-label">
      {icon}
      {text}
    </span>
  );
}

function entryLabel(e: MenuEntry, text: string) {
  const main = e.lane
    ? agentLabel(e.lane, text)
    : iconLabel(e.glyph ? glyphNode(e.glyph) : null, text);
  if (!e.blocked) return main;
  return (
    <span className="tui-menu-blocked">
      {main}
      <span className="tui-menu-reason">{e.blocked}</span>
    </span>
  );
}

/** Context menu anchored at the cursor. The kit's ContextMenu recipe owns
    the shell (box, viewport clamp, dismissals); this draws a list of entries
    in the board's three sections, plus the stages any entry can ask for: a
    second-click confirm, a picker, and the alt-click note box. */
function ActionMenu({
  x,
  y,
  subject,
  entries,
  empty,
  onRun,
  onClose,
}: {
  x: number;
  y: number;
  /** What the menu acts on: "!1418" or "5 selected". */
  subject: string;
  entries: MenuEntry[];
  /** Shown in place of the sections when there are no entries. */
  empty?: string;
  onRun: (key: string, opts: RunOpts) => void | Promise<unknown>;
  onClose: () => void;
}) {
  const [altHeld, setAltHeld] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [picking, setPicking] = useState<MenuEntry | null>(null);
  const [noteFor, setNoteFor] = useState<MenuEntry | null>(null);
  const [noteText, setNoteText] = useState('');
  const noteRef = useAutoGrowTextarea([noteFor, noteText]);
  // Screen readers skip text a live region already holds when it appears,
  // so the empty line mounts blank and is filled after mount.
  const [emptyNote, setEmptyNote] = useState('');
  useEffect(() => {
    setEmptyNote(entries.length === 0 && empty ? empty : '');
  }, [entries.length, empty]);
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const onBlur = () => setAltHeld(false);
    document.addEventListener('keydown', onAlt);
    document.addEventListener('keyup', onAlt);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onAlt);
      document.removeEventListener('keyup', onAlt);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const fire = (e: MenuEntry, opts: RunOpts = {}) => {
    void onRun(e.key, opts);
    onClose();
  };

  if (picking?.pick) {
    const pick = picking.pick;
    return (
      // Each stage is a distinct keyed ContextMenu: the recipe's viewport
      // clamp is a layout effect keyed on [x, y] only, so a new key is what
      // re-runs it against this stage's own size.
      <ContextMenu
        key="asking"
        x={x}
        y={y}
        ariaLabel={`${pick.aria} for ${subject}`}
        onClose={onClose}
      >
        <ContextMenu.Label>{pick.title}</ContextMenu.Label>
        {pick.options.map(o => (
          <ContextMenu.Item
            key={`ask-${o.value}`}
            label={iconLabel(
              picking.glyph ? glyphNode(picking.glyph) : null,
              o.value
            )}
            hint={o.hint}
            onClick={() => fire(picking, { pick: o.value })}
          />
        ))}
      </ContextMenu>
    );
  }

  if (noteFor) {
    return (
      <ContextMenu
        key="noting"
        x={x}
        y={y}
        ariaLabel={`note for ${subject}`}
        onClose={onClose}
        // The recipe focuses this once the clamp has committed and the menu
        // has stopped being `visibility: hidden`; `autoFocus`, or a focus call
        // from an effect here, would run while hidden and silently no-op.
        initialFocusRef={noteRef}
        className="tui-menu-noting"
      >
        <ContextMenu.Label>
          note for {noteFor.label} {subject}
        </ContextMenu.Label>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
          value={noteText}
          placeholder="extra instruction…"
          maxLength={2000}
          aria-label="launch note"
          onChange={e => {
            setNoteText(e.currentTarget.value);
          }}
          onKeyDown={e => {
            // Escape goes back to the item list, not out of the menu, and the
            // alt tracker stays honest while its document listener is muted.
            e.stopPropagation();
            setAltHeld(e.altKey);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              fire(noteFor, { note: noteText.trim() || undefined });
            } else if (e.key === 'Escape') {
              setNoteFor(null);
            }
          }}
        />
        <div className="tui-menu-note-hint">
          ↵ launch with note · ⇧↵ newline · esc back
        </div>
      </ContextMenu>
    );
  }

  // Armed against the exact wording: when a reload changes what a confirm
  // covers ("really merge 2?" becomes "3?"), the item disarms instead of
  // firing on a set nobody confirmed.
  const armKey = (e: MenuEntry) => `${e.key}|${e.confirm}`;
  const click = (e: MenuEntry) => (ev: React.MouseEvent) => {
    if (e.blocked) return;
    if (e.pick) {
      setPicking(e);
      return;
    }
    if (e.confirm && armed !== armKey(e)) {
      setArmed(armKey(e));
      return;
    }
    if (e.notable && ev.altKey) {
      setNoteText('');
      setNoteFor(e);
      return;
    }
    if (e.keepOpen) {
      if (pending.includes(e.key)) return;
      setPending(p => [...p, e.key]);
      void Promise.resolve(onRun(e.key, {})).finally(() =>
        setPending(p => p.filter(k => k !== e.key))
      );
      return;
    }
    fire(e);
  };
  const hintOf = (e: MenuEntry) =>
    e.blocked ? 'blocked' : e.notable && altHeld ? '+ note' : e.hint;
  const trailingOf = (e: MenuEntry) =>
    pending.includes(e.key) ? (
      <span className="tui-menu-spin" aria-label="working" />
    ) : e.marked ? (
      <span className="tui-menu-check">✓</span>
    ) : undefined;

  return (
    <ContextMenu
      key="items"
      x={x}
      y={y}
      ariaLabel={`actions for ${subject}`}
      onClose={onClose}
    >
      <ContextMenu.Label>{subject}</ContextMenu.Label>
      {entries.length === 0 && empty && (
        <div className="tui-menu-empty" aria-live="polite">
          {emptyNote}
        </div>
      )}
      {SECTIONS.map(([section, title]) => {
        const items = entries.filter(e => e.section === section);
        if (!items.length) return null;
        return (
          <Fragment key={section}>
            {section !== 'agent' && <ContextMenu.Separator />}
            <ContextMenu.Label>{title}</ContextMenu.Label>
            {items.map(e => (
              <ContextMenu.Item
                key={e.key}
                label={entryLabel(
                  e,
                  e.confirm && armed === armKey(e) ? e.confirm : e.label
                )}
                hint={hintOf(e)}
                trailing={trailingOf(e)}
                disabled={!!e.blocked || pending.includes(e.key)}
                onClick={click(e)}
              />
            ))}
          </Fragment>
        );
      })}
    </ContextMenu>
  );
}

export { ActionMenu };
