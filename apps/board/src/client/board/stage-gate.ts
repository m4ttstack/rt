import type { GateItemDisplay } from '@mattstack/gate-kit/react';

const RECOMMENDED_MARKER = /\s*\(\s*recommended\s*\)\s*/i;
const LEADING_PUNCTUATION = /^[\s.,;:\-\u2013\u2014]+/;

/** An agent's "(Recommended)" marker anywhere in a label, not only at its
    end: "Hand back (Recommended). I give you the branch" reads as the label
    "Hand back", the recommended flag, and "I give you the branch" as its
    subtitle. Board-local on purpose: gate-kit's `stripRecommended` output is
    rendered by the console too and must not change. */
export function splitRecommended(label: string): {
  text: string;
  recommended?: true;
  rest?: string;
} {
  const m = RECOMMENDED_MARKER.exec(label);
  if (!m) return { text: label };
  const before = label.slice(0, m.index).trim();
  const after = label
    .slice(m.index + m[0].length)
    .replace(LEADING_PUNCTUATION, '')
    .trim();
  if (!before && !after) return { text: label };
  if (!before) return { text: after, recommended: true };
  return after
    ? { text: before, recommended: true, rest: after }
    : { text: before, recommended: true };
}

/** A question's choices with any mid-label marker lifted off; an option's
    own description stays its subtitle when it has one, and the label's
    words after the marker then ride the label's hover title instead. */
export function stageDisplay(q: GateItemDisplay): GateItemDisplay {
  return {
    ...q,
    choices: q.choices.map(choice => {
      const s = splitRecommended(choice.label);
      if (!s.recommended) return choice;
      const subtitle = choice.subtitle ?? s.rest;
      const title = choice.subtitle !== undefined ? s.rest : undefined;
      return {
        ...choice,
        label: s.text,
        recommended: true,
        ...(subtitle !== undefined ? { subtitle } : {}),
        ...(title !== undefined ? { description: title } : {}),
      };
    }),
  };
}

/** "self-review" reads "Self review", "ship" reads "Ship". */
export function humanizeLabel(label: string): string {
  const words = label.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Claude Code's native prompt box opens with a rule of box-drawing
    characters; nothing else on a screen draws one that long. */
const PROMPT_RULE = /^─{20,}$/;
const PROMPT_TAIL_LINES = 12;

const isBlank = (line: string) => line.trim() === '';

function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start]!)) start++;
  while (end > start && isBlank(lines[end - 1]!)) end--;
  return lines.slice(start, end).join('\n');
}

/** A pane's last screen split into the prompt it is waiting on and the
    output above it: the prompt is everything after the last prompt-box rule
    that has anything after it, else the last twelve non-blank lines. */
export function splitPaneScreen(screen: string): {
  prompt: string;
  earlier: string;
} {
  const lines = screen.split(/\r?\n/).map(line => line.trimEnd());
  let cut = -1;
  let seenContent = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (seenContent && PROMPT_RULE.test(line.trim())) {
      cut = i;
      break;
    }
    if (!isBlank(line)) seenContent = true;
  }
  if (cut >= 0)
    return {
      prompt: trimBlankLines(lines.slice(cut + 1)),
      earlier: trimBlankLines(lines.slice(0, cut)),
    };
  let start = lines.length;
  for (let seen = 0; start > 0 && seen < PROMPT_TAIL_LINES;) {
    start--;
    if (!isBlank(lines[start]!)) seen++;
  }
  return {
    prompt: trimBlankLines(lines.slice(start)),
    earlier: trimBlankLines(lines.slice(0, start)),
  };
}
