import { describe, expect, test } from 'bun:test';

import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import {
  humanizeLabel,
  splitPaneScreen,
  splitRecommended,
  stageDisplay,
} from '../stage-gate.ts';

const RULE = '─'.repeat(40);

describe('splitPaneScreen', () => {
  test('the prompt is everything after the rule; the rest is earlier output', () => {
    const screen = [
      'Ran the suite, all green.',
      '',
      RULE,
      ' Tool use',
      '   Entering worktree(harbor)',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
    ].join('\n');
    expect(splitPaneScreen(screen)).toEqual({
      prompt: [
        ' Tool use',
        '   Entering worktree(harbor)',
        ' Do you want to proceed?',
        ' ❯ 1. Yes',
        '   2. No',
      ].join('\n'),
      earlier: 'Ran the suite, all green.',
    });
  });

  test('with several rules the last one wins', () => {
    const screen = [
      'first output',
      RULE,
      'an older box',
      RULE,
      'the live prompt',
    ].join('\n');
    expect(splitPaneScreen(screen)).toEqual({
      prompt: 'the live prompt',
      earlier: ['first output', RULE, 'an older box'].join('\n'),
    });
  });

  test('a rule shorter than twenty characters is not the prompt box', () => {
    const short = '─'.repeat(19);
    const screen = ['above', short, 'below'].join('\n');
    expect(splitPaneScreen(screen)).toEqual({
      prompt: ['above', short, 'below'].join('\n'),
      earlier: '',
    });
  });

  test('a line mixing the rule with other characters is not a rule', () => {
    const screen = ['above', `${RULE} x`, 'below'].join('\n');
    expect(splitPaneScreen(screen).earlier).toBe('');
  });

  test('with no rule the prompt is the last twelve non-blank lines', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    lines.splice(10, 0, '');
    const { prompt, earlier } = splitPaneScreen(lines.join('\n'));
    expect(prompt.split('\n')).toEqual([
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      '',
      'line 11',
      'line 12',
      'line 13',
      'line 14',
      'line 15',
    ]);
    expect(earlier).toBe(['line 1', 'line 2', 'line 3'].join('\n'));
  });

  test('a short screen with no rule is all prompt', () => {
    expect(splitPaneScreen('one\ntwo')).toEqual({
      prompt: 'one\ntwo',
      earlier: '',
    });
  });

  test('an empty or blank screen splits to nothing', () => {
    expect(splitPaneScreen('')).toEqual({ prompt: '', earlier: '' });
    expect(splitPaneScreen('\n  \n\n')).toEqual({ prompt: '', earlier: '' });
  });

  test('leading and trailing blank lines are trimmed; inner indentation stays', () => {
    const screen = [
      '',
      '  ',
      'earlier',
      '',
      RULE,
      '',
      '   indented question?',
      '',
      '     deeper',
      '',
      '   ',
    ].join('\n');
    expect(splitPaneScreen(screen)).toEqual({
      prompt: ['   indented question?', '', '     deeper'].join('\n'),
      earlier: 'earlier',
    });
  });

  test('a rule with nothing after it does not count', () => {
    const screen = ['the question?', '1. Yes', RULE, ''].join('\n');
    expect(splitPaneScreen(screen)).toEqual({
      prompt: ['the question?', '1. Yes', RULE].join('\n'),
      earlier: '',
    });
  });

  test('carriage returns and trailing spaces are dropped', () => {
    expect(splitPaneScreen(`a  \r\n${RULE}\r\nb  \r\n`)).toEqual({
      prompt: 'b',
      earlier: 'a',
    });
  });
});

describe('splitRecommended', () => {
  test('a mid-label marker splits the label, the chip and the subtitle', () => {
    expect(
      splitRecommended('Hand back (Recommended). I give you the branch.')
    ).toEqual({
      text: 'Hand back',
      recommended: true,
      rest: 'I give you the branch.',
    });
  });

  test('a trailing marker leaves no subtitle', () => {
    expect(splitRecommended('Draft (Recommended)')).toEqual({
      text: 'Draft',
      recommended: true,
    });
  });

  test('no marker leaves the label alone', () => {
    expect(splitRecommended('Hold the run here.')).toEqual({
      text: 'Hold the run here.',
    });
  });

  test('a lowercase marker counts', () => {
    expect(splitRecommended('preview-a (recommended): QA data')).toEqual({
      text: 'preview-a',
      recommended: true,
      rest: 'QA data',
    });
  });

  test('a marker with only punctuation after it leaves no subtitle', () => {
    expect(splitRecommended('Hand back (Recommended).')).toEqual({
      text: 'Hand back',
      recommended: true,
    });
  });

  test('a dash after the marker is punctuation, not the subtitle', () => {
    expect(splitRecommended('Ship it (Recommended) \u2014 all green')).toEqual({
      text: 'Ship it',
      recommended: true,
      rest: 'all green',
    });
  });

  test('a marker that leads the label keeps the words after it as the label', () => {
    expect(splitRecommended('(Recommended) Hand back')).toEqual({
      text: 'Hand back',
      recommended: true,
    });
  });
});

describe('stageDisplay', () => {
  const q = (choices: GateItemDisplay['choices']): GateItemDisplay => ({
    name: 'handoff',
    prompt: 'How do we hand off?',
    multiple: false,
    required: true,
    choices,
  });

  test('a mid-label marker becomes the label, the recommended flag and the subtitle', () => {
    expect(
      stageDisplay(
        q([
          {
            value: 'hand-back',
            label: 'Hand back (Recommended). I give you the branch.',
            description: 'hand-back',
          },
          { value: 'hold', label: 'Hold the run here.' },
        ])
      ).choices
    ).toEqual([
      {
        value: 'hand-back',
        label: 'Hand back',
        description: 'hand-back',
        recommended: true,
        subtitle: 'I give you the branch.',
      },
      { value: 'hold', label: 'Hold the run here.' },
    ]);
  });

  test("an option's own description stays its subtitle; the label's words after the marker ride its title", () => {
    expect(
      stageDisplay(
        q([
          {
            value: 'draft',
            label: 'Draft (Recommended). Evidence is outstanding.',
            description: 'draft',
            subtitle: 'Opens the MR as a draft.',
          },
        ])
      ).choices[0]
    ).toEqual({
      value: 'draft',
      label: 'Draft',
      description: 'Evidence is outstanding.',
      subtitle: 'Opens the MR as a draft.',
      recommended: true,
    });
  });

  test('a choice the kit already marked keeps its flag', () => {
    expect(
      stageDisplay(q([{ value: 'draft', label: 'Draft', recommended: true }]))
        .choices[0]
    ).toEqual({ value: 'draft', label: 'Draft', recommended: true });
  });
});

describe('humanizeLabel', () => {
  test('a kind-shaped label reads as words with a leading capital', () => {
    expect(humanizeLabel('ship')).toBe('Ship');
    expect(humanizeLabel('self-review')).toBe('Self review');
    expect(humanizeLabel('mark_ready')).toBe('Mark ready');
    expect(humanizeLabel('clarify !40')).toBe('Clarify !40');
  });
});
