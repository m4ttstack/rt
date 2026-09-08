// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import type { GateSelections } from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
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
});

/** The minimal styled-layer shape both apps copy: selections state drives
    gateItems (structural collapse), the native form drives answersFromForm.
    The primitive is step-shaped (every non-active Item renders hidden and
    inert); the explicit hidden/inert overrides are what make a flat card
    possible. */
function Harness({
  gate,
  onAnswers,
}: {
  gate: GateForItems;
  onAnswers: (payload: { answers: GateSelections } | null) => void;
}) {
  const [selections, setSelections] = useState<GateSelections>({});
  const { items, display } = gateItems(gate, selections);
  return (
    <Questionnaire.Root
      items={items}
      onSubmit={event => {
        event.preventDefault();
        onAnswers(answersFromForm(gate, new FormData(event.currentTarget)));
      }}
    >
      {display.map(item => (
        <Questionnaire.Item
          key={item.name}
          name={item.name}
          required={item.required}
          multiple={item.multiple}
          hidden={false}
          inert={false}
        >
          <Questionnaire.Title>{item.prompt}</Questionnaire.Title>
          <Questionnaire.Choices>
            {item.choices.map(choice => (
              <Questionnaire.Choice
                key={choice.value}
                value={choice.value}
                onChange={event => {
                  const { checked } = event.currentTarget;
                  setSelections(prev => {
                    if (!item.multiple)
                      return { ...prev, [item.name]: choice.value };
                    const current = prev[item.name];
                    const next = new Set(Array.isArray(current) ? current : []);
                    if (checked) next.add(choice.value);
                    else next.delete(choice.value);
                    return { ...prev, [item.name]: [...next] };
                  });
                }}
              >
                <Questionnaire.ChoiceInput />
                <Questionnaire.ChoiceLabel>
                  {choice.label}
                </Questionnaire.ChoiceLabel>
              </Questionnaire.Choice>
            ))}
          </Questionnaire.Choices>
        </Questionnaire.Item>
      ))}
      <button type="submit">submit</button>
    </Questionnaire.Root>
  );
}

describe('questionnaire round trip', () => {
  test('every item is visible and usable at once: the flat card overrides the step machinery', () => {
    render(<Harness gate={PLAIN_GATE} onAnswers={() => {}} />);
    // byRole (hidden: false) excludes any subtree under a [hidden] fieldset,
    // so this fails the moment an Item is left in the primitive's step mode.
    expect(screen.getByRole('radio', { name: 'passed' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'lint' })).toBeEnabled();
    // jest-dom's toBeEnabled does not read `inert`; pin it directly so an
    // Item that lost only inert={false} cannot pass while staying unclickable.
    expect(
      screen.getByRole('checkbox', { name: 'lint' }).closest('fieldset')
    ).not.toHaveAttribute('inert');
  });

  test('the code-changes item becomes visible and usable when a fix is picked, and disappears again', async () => {
    render(<Harness gate={RESPOND_GATE} onAnswers={() => {}} />);
    expect(
      screen.queryByRole('radio', { name: 'approve' })
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    expect(screen.getByRole('radio', { name: 'approve' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'approve' })).toBeEnabled();
    expect(
      screen.getByText('Approve the proposed code changes?')
    ).toBeVisible();

    await userEvent.click(screen.getByRole('checkbox', { name: 'fix:t1' }));
    expect(
      screen.queryByRole('radio', { name: 'approve' })
    ).not.toBeInTheDocument();
  });

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
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(onAnswers).toHaveBeenCalledWith({
      answers: { outcome: 'pass', flags: ['lint'] },
    });
  });
});
