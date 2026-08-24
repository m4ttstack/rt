import { describe, expect, it } from 'vitest';

import { parseSeam, splitCompiledBody } from './parseSeam';

/** Verbatim from `lib/skills/compile.ts` (`HEADER_COMMENT`). Invented text
    would pass this file's header test for the wrong reason -- every line
    that is not `<!-- part: ` returns null -- and pin nothing. */
const HEADER_COMMENT =
  '<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->';

const STEP_SEAM =
  '<!-- part: step source=mattstack:work version=0.8.0 path=attachments/pipeline/work/SKILL.md lines=17-135 -->';
const SLOT_SEAM =
  '<!-- part: slot:tiering binding=mattstack:model-tiering version=0.8.0 path=attachments/model-tiering/SKILL.md lines=8-117 -->';
/** The compile-native refactor's third shape (spec section 1, reply
    2026-08-24): an author-fixed inline, so it carries `source=` like a step,
    with the attachment name inside the kind token like a slot. */
const INCLUDE_SEAM =
  '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=3-40 -->';

describe('parseSeam: the shapes the compiler emits', () => {
  it('reads a step seam as its source, version, path and inclusive line span', () => {
    expect(parseSeam(STEP_SEAM)).toEqual({
      kind: 'step',
      slot: null,
      ref: 'mattstack:work',
      version: '0.8.0',
      path: 'attachments/pipeline/work/SKILL.md',
      lines: [17, 135],
    });
  });

  it('reads a slot seam by its binding, and names the slot the kind token carries', () => {
    // The slot's name lives INSIDE the kind token (`slot:tiering`) and the
    // ref arrives under `binding=`, not `source=` -- a parser written for the
    // step shape alone reports every fill as unattributed.
    expect(parseSeam(SLOT_SEAM)).toEqual({
      kind: 'slot',
      slot: 'tiering',
      ref: 'mattstack:model-tiering',
      version: '0.8.0',
      path: 'attachments/model-tiering/SKILL.md',
      lines: [8, 117],
    });
  });

  it('reads an include seam by its source, naming the attachment the kind token carries', () => {
    // include is author-fixed, so its ref arrives under `source=` (not
    // `binding=`), and its target name lives inside the kind token like a
    // slot's. A parser that only knew step/slot would drop it, leaving the
    // inlined region unattributed.
    expect(parseSeam(INCLUDE_SEAM)).toEqual({
      kind: 'include',
      slot: 'review-shared',
      ref: 'mattstack:review-shared',
      version: '0.9.0',
      path: 'attachments/review-shared/SKILL.md',
      lines: [3, 40],
    });
  });

  it('reads two include seams for one attachment split around a slot, by their spans', () => {
    // A shared attachment interrupted by a verb's slot emits as two includes
    // with the same ref and different spans (reply 2026-08-24). Both parse;
    // enumeration by ref must expect the repeat.
    const head = parseSeam(
      '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=3-19 -->'
    );
    const tail = parseSeam(
      '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=28-40 -->'
    );
    expect(head?.ref).toBe('mattstack:review-shared');
    expect(tail?.ref).toBe('mattstack:review-shared');
    expect(head?.lines).toEqual([3, 19]);
    expect(tail?.lines).toEqual([28, 40]);
  });
});

describe('parseSeam: everything else is not a seam', () => {
  it('returns null for a truncated seam rather than a partly-filled object', () => {
    // A half-parsed seam heads a section with the wrong provenance, which is
    // worse than heading it with none.
    expect(parseSeam('<!-- part: step source=x -->')).toBeNull();
  });

  it('returns null when the kind and the ref key disagree', () => {
    // The emitter pairs `step` with `source=` and `slot:<name>` with
    // `binding=`. Accepting a crossed pair would invent a seam shape rt
    // cannot produce and attribute a section from it.
    expect(
      parseSeam(
        '<!-- part: step binding=mattstack:work version=0.8.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
    expect(
      parseSeam(
        '<!-- part: slot:tiering source=mattstack:model-tiering version=0.8.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
    // include is author-fixed like a step, so it pairs with `source=`; a
    // `binding=` include is the same crossed shape the emitter never writes.
    expect(
      parseSeam(
        '<!-- part: include:review-shared binding=mattstack:review-shared version=0.9.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
  });

  it('returns null for a slot seam with no slot name', () => {
    expect(
      parseSeam(
        '<!-- part: slot: binding=mattstack:x version=1 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
  });

  it('returns null for a non-numeric line span', () => {
    expect(
      parseSeam(
        '<!-- part: step source=mattstack:work version=0.8.0 path=a/SKILL.md lines=eight-nine -->'
      )
    ).toBeNull();
  });

  it('does not read the compiler header as a seam', () => {
    expect(parseSeam(HEADER_COMMENT)).toBeNull();
  });

  it('does not read prose or a blank line as a seam', () => {
    expect(parseSeam('# work -- the orchestrator')).toBeNull();
    expect(parseSeam('')).toBeNull();
  });
});

describe('splitCompiledBody', () => {
  const BODY = [
    '---',
    'name: "work"',
    '---',
    '',
    HEADER_COMMENT,
    '',
    STEP_SEAM,
    '',
    '# work',
    '',
    'The orchestrator body.',
    '',
    SLOT_SEAM,
    '',
    '# Model Tiering',
  ].join('\n');

  it('opens with the frontmatter and the compiler header, under no seam', () => {
    const [preamble] = splitCompiledBody(BODY);

    expect(preamble.seam).toBeNull();
    expect(preamble.text).toBe(
      ['---', 'name: "work"', '---', '', HEADER_COMMENT].join('\n')
    );
  });

  it('gives each seam its own section and keeps the seam line out of the text', () => {
    const sections = splitCompiledBody(BODY);

    expect(sections.map(s => s.seam?.slot ?? s.seam?.kind ?? null)).toEqual([
      null,
      'step',
      'tiering',
    ]);
    expect(sections[1].text).toBe('# work\n\nThe orchestrator body.');
    expect(sections[2].text).toBe('# Model Tiering');
    expect(sections.some(s => s.text.includes('<!-- part:'))).toBe(false);
  });

  it('renders a body with no seams at all as one unattributed section', () => {
    // An errored or hand-authored body still has to reach the pane; dropping
    // everything that carries no seam would render a blank one.
    const sections = splitCompiledBody('---\nname: "work"\n---\n');

    expect(sections).toEqual([{ seam: null, text: '---\nname: "work"\n---' }]);
  });

  it('emits no empty leading section when a body opens on a seam', () => {
    const sections = splitCompiledBody(`${STEP_SEAM}\n\n# work`);

    expect(sections).toHaveLength(1);
    expect(sections[0].seam?.ref).toBe('mattstack:work');
  });
});
