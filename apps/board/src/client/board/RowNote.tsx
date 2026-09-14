import { useEffect, useState } from 'react';

import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { NoteGlyph } from './icons.tsx';

/** The row's last line (B10): a note the seat wrote for itself, in a band
    under everything the row already says. At rest it is text; under the
    pointer it ends in "dismiss note"; a click turns it into the same
    auto-growing textarea the Slack header and the launch note use. */
export function RowNote({
  mr,
  ctx,
  editing,
}: {
  mr: BoardMRWithReview;
  ctx: RowContext;
  editing: boolean;
}) {
  const note = mr.note ?? '';
  const [text, setText] = useState(note);
  // A reload while the box is open must not overwrite what is being typed,
  // so the draft only re-seeds when the editor opens (or the row changes).
  useEffect(() => {
    if (editing) setText(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mr.webUrl]);
  const ref = useAutoGrowTextarea([editing, text]);

  if (editing)
    return (
      <div className="tui-row-note" data-editing="true">
        <div className="tui-row-note-lead">
          <NoteGlyph size={12} />
          <textarea
            ref={ref}
            className="tui-row-note-input"
            rows={1}
            value={text}
            placeholder="a note for yourself…"
            maxLength={2000}
            aria-label={`note on !${mr.iid}`}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ctx.onSaveNote(mr, text);
              } else if (e.key === 'Escape') {
                ctx.onEditNote(null);
              }
            }}
            onChange={e => setText(e.currentTarget.value)}
          />
        </div>
        <div className="tui-row-note-hint">
          ↵ saves · ⇧↵ newline · esc cancels · an empty save clears the note
        </div>
      </div>
    );

  return (
    <div
      className="tui-row-note"
      role="button"
      tabIndex={0}
      title="edit this note"
      onClick={e => {
        e.stopPropagation();
        ctx.onEditNote(mr.webUrl ?? null);
      }}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        ctx.onEditNote(mr.webUrl ?? null);
      }}
    >
      <NoteGlyph size={12} />
      <span className="tui-row-note-text">{note}</span>
      <button
        type="button"
        className="tui-row-note-dismiss"
        onClick={e => {
          e.stopPropagation();
          ctx.onSaveNote(mr, '');
        }}
      >
        dismiss note
      </button>
    </div>
  );
}
