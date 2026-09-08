// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import type { GateAnswers, GateSelections } from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  noteFieldName,
  Questionnaire,
  type GateForItems,
} from '@mattstack/gate-kit/react';

const RESPOND_GATE: GateForItems = {
  kind: 'respond-plan',
  questions: [
    {
      id: 'threads-1',
      label: 'Threads',
      multi: true,
      options: ['reply:t1', 'fix:t1', 'skip:t1'],
    },
    {
      id: 'code-changes',
      label: 'Approve the proposed code changes?',
      multi: false,
      options: ['approve', 'revise', 'skip'],
    },
  ],
};

const PLAIN_GATE: GateForItems = {
  kind: 'self-review',
  questions: [
    {
      id: 'outcome',
      label: 'What happened?',
      multi: false,
      options: [{ value: 'pass', label: 'passed' }, 'fail'],
    },
    {
      id: 'flags',
      label: 'Any flags?',
      multi: true,
      options: ['lint', 'types'],
    },
  ],
};

const VERB_GATE: GateForItems = {
  kind: 'respond-plan',
  questions: [
    {
      id: 'threads-1',
      label: 'Threads',
      multi: true,
      options: ['reply:t1', 'fix:t1', 'skip:t1'],
    },
  ],
};

describe('gateItems', () => {
  test('maps questions to item definitions plus display data, labels via the option transform', () => {
    const { items, display } = gateItems(PLAIN_GATE, {});
    expect(items).toEqual([
      {
        name: 'outcome',
        required: true,
        choices: [{ value: 'pass' }, { value: 'fail' }],
      },
      {
        name: 'flags',
        required: true,
        choices: [{ value: 'lint' }, { value: 'types' }],
      },
    ]);
    expect(display[0]).toEqual({
      name: 'outcome',
      prompt: 'What happened?',
      multiple: false,
      required: true,
      choices: [
        { value: 'pass', label: 'passed', description: 'pass' },
        { value: 'fail', label: 'fail' },
      ],
      groups: null,
    });
    expect(display[1]!.multiple).toBe(true);
  });

  test('a zero-option question is excluded: nothing to collect, and the payload rule already exempts it', () => {
    const gate: GateForItems = {
      kind: 'review-post',
      questions: [
        {
          id: 'tiers',
          label: 'Post which findings?',
          multi: true,
          options: [],
        },
        { id: 'outcome', label: 'Verdict', multi: false, options: ['comment'] },
      ],
    };
    const { items } = gateItems(gate, {});
    expect(items.map(i => i.name)).toEqual(['outcome']);
  });

  test('the respond collapse is structural: code-changes is absent until a fix: selection exists', () => {
    expect(gateItems(RESPOND_GATE, {}).items.map(i => i.name)).toEqual([
      'threads-1',
    ]);
    expect(
      gateItems(RESPOND_GATE, { 'threads-1': ['reply:t1'] }).items.map(
        i => i.name
      )
    ).toEqual(['threads-1']);
    expect(
      gateItems(RESPOND_GATE, { 'threads-1': ['fix:t1'] }).items.map(
        i => i.name
      )
    ).toEqual(['threads-1', 'code-changes']);
  });

  test('grouped-rendering data rides along for multi questions that group', () => {
    const gate: GateForItems = {
      kind: 'respond-plan',
      questions: [
        {
          id: 'threads-1',
          label: 'Threads',
          multi: true,
          options: [
            'reply:t1',
            'fix:t1',
            'skip:t1',
            'reply:t2',
            'fix:t2',
            'skip:t2',
          ],
        },
      ],
    };
    const { display } = gateItems(gate, {});
    expect(display[0]!.groups?.map(g => g.token)).toEqual(['t1', 't2']);
  });

  test('a labeled option carries the recommended flag through to its display choice', () => {
    const gate: GateForItems = {
      kind: 'self-review',
      questions: [
        {
          id: 'outcome',
          label: 'What happened?',
          multi: false,
          options: [
            { value: 'approve', label: 'Approve (recommended)' },
            { value: 'comment', label: 'Comment' },
          ],
        },
      ],
    };
    const { display } = gateItems(gate, {});
    expect(display[0]!.choices[0]).toEqual({
      value: 'approve',
      label: 'Approve',
      description: 'approve',
      recommended: true,
    });
    expect(display[0]!.choices[1]).not.toHaveProperty('recommended');
  });
});

describe('answersFromForm', () => {
  test('reads a radio with get and checkboxes with getAll, and refuses an incomplete form', () => {
    const complete = new FormData();
    complete.set('outcome', 'pass');
    complete.append('flags', 'lint');
    complete.append('flags', 'types');
    expect(answersFromForm(PLAIN_GATE, complete)).toEqual({
      answers: { outcome: 'pass', flags: ['lint', 'types'] },
    });

    const incomplete = new FormData();
    incomplete.set('outcome', 'pass');
    expect(answersFromForm(PLAIN_GATE, incomplete)).toBeNull();
  });

  test('the structurally excluded code-changes item submits the sentinel', () => {
    const form = new FormData();
    form.append('threads-1', 'reply:t1');
    expect(answersFromForm(RESPOND_GATE, form)).toEqual({
      answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' },
    });
  });

  test('noteFieldName suffixes the question id', () => {
    expect(noteFieldName('outcome')).toBe('outcome:note');
  });

  test('a non-empty note wraps the selection as { value, note } for single and multi; a blank note leaves the bare value', () => {
    const noted = new FormData();
    noted.set('outcome', 'pass');
    noted.set(noteFieldName('outcome'), '  needs a follow-up  ');
    noted.append('flags', 'lint');
    noted.append('flags', 'types');
    noted.set(noteFieldName('flags'), 'both');
    expect(answersFromForm(PLAIN_GATE, noted)).toEqual({
      answers: {
        outcome: { value: 'pass', note: 'needs a follow-up' },
        flags: { value: ['lint', 'types'], note: 'both' },
      },
    });

    const blank = new FormData();
    blank.set('outcome', 'pass');
    blank.set(noteFieldName('outcome'), '   ');
    blank.append('flags', 'lint');
    expect(answersFromForm(PLAIN_GATE, blank)).toEqual({
      answers: { outcome: 'pass', flags: ['lint'] },
    });
  });

  test('a note never rescues an incomplete form, and the injected sentinel never carries one', () => {
    const noPick = new FormData();
    noPick.set(noteFieldName('outcome'), 'text without a pick');
    expect(answersFromForm(PLAIN_GATE, noPick)).toBeNull();

    const respond = new FormData();
    respond.append('threads-1', 'reply:t1');
    respond.set(noteFieldName('code-changes'), 'stray');
    expect(answersFromForm(RESPOND_GATE, respond)).toEqual({
      answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' },
    });
  });
});

const VERB_OPTION = /^(reply|fix|skip):(.+)$/;

/** Both apps' cards in miniature, in the primitive's own step mode: one
    active Item at a time, `shortcuts="numbers"`, a key hint and an Error per
    item, a native note input named by the adapter, and the primitive's
    Previous / Next / Submit. Every Choice is controlled from `selections`
    (a remounted item comes back wearing its answer; `toggle` carries the
    board's one-verb-per-thread rule); the native form is the only door to
    submission. */
function Harness({
  gate,
  onAnswers,
}: {
  gate: GateForItems;
  onAnswers: (payload: { answers: GateAnswers } | null) => void;
}) {
  const [selections, setSelections] = useState<GateSelections>({});
  const { items, display } = gateItems(gate, selections);

  const toggle = (
    name: string,
    multiple: boolean,
    value: string,
    checked: boolean
  ) => {
    setSelections(prev => {
      if (!multiple) return { ...prev, [name]: value };
      const current = prev[name];
      const set = new Set(Array.isArray(current) ? current : []);
      const token = VERB_OPTION.exec(value)?.[2];
      if (token !== undefined) {
        for (const v of set)
          if (VERB_OPTION.exec(v)?.[2] === token) set.delete(v);
      }
      if (checked) set.add(value);
      return { ...prev, [name]: [...set] };
    });
  };

  return (
    <Questionnaire.Root
      items={items}
      shortcuts="numbers"
      onSubmit={event => {
        event.preventDefault();
        onAnswers(answersFromForm(gate, new FormData(event.currentTarget)));
      }}
    >
      <Questionnaire.Progress
        render={(props, state) => (
          <span {...props}>
            {state.current} of {state.total}
          </span>
        )}
      />
      {display.map(item => {
        const current = selections[item.name];
        const picked = new Set(Array.isArray(current) ? current : []);
        return (
          <Questionnaire.Item
            key={item.name}
            name={item.name}
            required={item.required}
            multiple={item.multiple}
            data-testid={`item-${item.name}`}
          >
            <Questionnaire.Title>{item.prompt}</Questionnaire.Title>
            <Questionnaire.Choices>
              {item.choices.map(choice => (
                <Questionnaire.Choice
                  key={choice.value}
                  value={choice.value}
                  checked={
                    item.multiple
                      ? picked.has(choice.value)
                      : current === choice.value
                  }
                  onChange={event =>
                    toggle(
                      item.name,
                      item.multiple,
                      choice.value,
                      event.currentTarget.checked
                    )
                  }
                >
                  <Questionnaire.ChoiceInput />
                  <Questionnaire.ChoiceLabel>
                    {choice.label}
                  </Questionnaire.ChoiceLabel>
                  <Questionnaire.ChoiceShortcut
                    data-testid={`key-${choice.value}`}
                  />
                </Questionnaire.Choice>
              ))}
            </Questionnaire.Choices>
            <Questionnaire.Error />
            <input
              type="text"
              name={noteFieldName(item.name)}
              aria-label={`Note for ${item.prompt}`}
            />
          </Questionnaire.Item>
        );
      })}
      <Questionnaire.Previous>previous</Questionnaire.Previous>
      <Questionnaire.Next>next</Questionnaire.Next>
      <Questionnaire.Submit>submit</Questionnaire.Submit>
    </Questionnaire.Root>
  );
}

describe('step contract', () => {
  test('a single-item gate renders its item visible with Submit and no Previous or Next', () => {
    render(<Harness gate={VERB_GATE} onAnswers={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'reply:t1' })).toBeVisible();
    const item = screen.getByTestId('item-threads-1');
    expect(item).not.toHaveAttribute('hidden');
    expect(item).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'next' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'previous' })
    ).not.toBeInTheDocument();
  });

  test('with two items only the active one is visible; the other is hidden and inert; Next advances and Previous returns', async () => {
    render(<Harness gate={PLAIN_GATE} onAnswers={() => {}} />);
    expect(screen.getByRole('radio', { name: 'passed' })).toBeVisible();
    // byRole (hidden: false) excludes the subtree under a [hidden] fieldset.
    expect(
      screen.queryByRole('checkbox', { name: 'lint' })
    ).not.toBeInTheDocument();
    const flags = screen.getByTestId('item-flags');
    expect(flags).toHaveAttribute('hidden');
    // jest-dom's toBeVisible does not read `inert`; pin it directly.
    expect(flags).toHaveAttribute('inert');
    expect(screen.getByRole('progressbar')).toHaveTextContent('1 of 2');
    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'passed' }));
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeVisible();
    expect(screen.getByTestId('item-outcome')).toHaveAttribute('hidden');
    expect(screen.getByTestId('item-outcome')).toHaveAttribute('inert');
    expect(screen.getByRole('progressbar')).toHaveTextContent('2 of 2');
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'previous' }));
    expect(screen.getByRole('radio', { name: 'passed' })).toBeChecked();
    expect(screen.getByRole('progressbar')).toHaveTextContent('1 of 2');
  });

  test('Next with nothing picked stays put and shows the required message', async () => {
    render(<Harness gate={PLAIN_GATE} onAnswers={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an answer to continue.'
    );
    expect(screen.getByRole('progressbar')).toHaveTextContent('1 of 2');
  });

  test('the code-changes item joins as a new last step on a fix pick, Submit moves to it, and it leaves again when the fix is unticked', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={RESPOND_GATE} onAnswers={onAnswers} />);
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    expect(
      screen.queryByRole('button', { name: 'submit' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveTextContent('1 of 2');
    expect(
      screen.queryByRole('radio', { name: 'approve' })
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('radio', { name: 'approve' })).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'approve' }));

    await userEvent.click(screen.getByRole('button', { name: 'previous' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    expect(screen.queryByTestId('item-code-changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();

    // The mirror still holds 'code-changes', so the remounted controlled
    // radio must come back pre-checked without a second click.
    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('radio', { name: 'approve' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(onAnswers).toHaveBeenCalledWith({
      answers: { 'threads-1': ['fix:t1'], 'code-changes': 'approve' },
    });
  });
});

describe('shortcuts', () => {
  test('keypress 2 inside the active item picks its second choice, and only the active item listens', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={PLAIN_GATE} onAnswers={onAnswers} />);
    expect(screen.getByTestId('key-pass')).toHaveTextContent('1');
    expect(screen.getByTestId('key-fail')).toHaveTextContent('2');
    expect(screen.getByTestId('key-fail')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    // Root's keydown handler lives on the <form>, so the key has to
    // originate inside it: focus a control of the active item first.
    screen.getByRole('radio', { name: 'passed' }).focus();
    await userEvent.keyboard('2');
    expect(screen.getByRole('radio', { name: 'fail' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    screen.getByRole('checkbox', { name: 'lint' }).focus();
    await userEvent.keyboard('2');
    expect(screen.getByRole('checkbox', { name: 'types' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'lint' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(onAnswers).toHaveBeenCalledWith({
      answers: { outcome: 'fail', flags: ['types'] },
    });
  });

  test('typing 2 into the note field is text, not a shortcut', async () => {
    render(<Harness gate={VERB_GATE} onAnswers={() => {}} />);
    await userEvent.type(screen.getByLabelText('Note for Threads'), '2');
    expect(screen.getByRole('checkbox', { name: 'fix:t1' })).not.toBeChecked();
    expect(screen.getByLabelText('Note for Threads')).toHaveValue('2');
  });
});

describe('questionnaire round trip', () => {
  test('submit delivers one atomic FormData answer with the sentinel injected for the hidden item', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={RESPOND_GATE} onAnswers={onAnswers} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'reply:t1' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(onAnswers).toHaveBeenCalledWith({
      answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' },
    });
  });

  test('exact option values round-trip through the form, labels never leak into the answer', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={PLAIN_GATE} onAnswers={onAnswers} />);

    await userEvent.click(screen.getByRole('radio', { name: 'passed' }));
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(onAnswers).toHaveBeenCalledWith({
      answers: { outcome: 'pass', flags: ['lint'] },
    });
  });

  test('a note rides along as { value, note } and an untouched note leaves the bare value', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={PLAIN_GATE} onAnswers={onAnswers} />);

    await userEvent.click(screen.getByRole('radio', { name: 'passed' }));
    await userEvent.type(
      screen.getByLabelText('Note for What happened?'),
      ' flaky on retry '
    );
    await userEvent.click(screen.getByRole('button', { name: 'next' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(onAnswers).toHaveBeenCalledWith({
      answers: {
        outcome: { value: 'pass', note: 'flaky on retry' },
        flags: ['lint'],
      },
    });
  });

  test('a controlled checkbox forces its sibling to uncheck: the primitive is not left to native checkbox semantics', async () => {
    const onAnswers = vi.fn();
    render(<Harness gate={VERB_GATE} onAnswers={onAnswers} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'reply:t1' }));
    expect(screen.getByRole('checkbox', { name: 'reply:t1' })).toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    // Two independent <input type="checkbox"> elements never uncheck each
    // other natively; this only holds if the primitive re-applies `checked`
    // from the next render's props rather than trusting the DOM's own state.
    expect(
      screen.getByRole('checkbox', { name: 'reply:t1' })
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'fix:t1' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(onAnswers).toHaveBeenCalledWith({
      answers: { 'threads-1': ['fix:t1'] },
    });
  });
});
