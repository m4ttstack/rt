import { useMemo, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Kbd,
  Radio,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import type { GateAnswers, GateSelections } from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  noteFieldName,
  Questionnaire,
  type GateForItems,
} from '@mattstack/gate-kit/react';

import classes from './GateQuestionnaire.module.css';

/** Mantine-styled layer over the kit's questionnaire adapter, in the
    primitive's own step mode: one active Item at a time (the others render
    hidden and inert), a progress line and Previous / Reset only when there
    is more than one item, Submit only on the last. The native form is the
    one door to submission: FormData, not component state, builds the
    answer. Every choice is controlled from `selections` so a question that
    unmounts and comes back (the respond collapse) remounts wearing its
    answer, and the FormData the submit reads still mirrors that state.
    Next and Submit disable until the active item is answered or skipped,
    so the enabled button always does something; Cmd/Ctrl+Enter stays the
    primitive's validate-and-advance path and surfaces the error line. */
export function GateQuestionnaire({
  gate,
  selections,
  onSelectionsChange,
  notes,
  onNoteChange,
  step,
  onStepChange,
  onReset,
  busy,
  onSubmitAnswers,
  status,
  focus,
}: {
  gate: GateForItems;
  selections: GateSelections;
  onSelectionsChange: (next: GateSelections) => void;
  notes: Record<string, string>;
  onNoteChange: (name: string, value: string) => void;
  step: string | null;
  onStepChange: (name: string) => void;
  onReset: () => void;
  busy: boolean;
  onSubmitAnswers: (payload: { answers: GateAnswers } | null) => void;
  status: ReactNode;
  focus: ReactNode;
}) {
  const { items, display } = useMemo(
    () => gateItems(gate, selections),
    [gate, selections]
  );
  const stepped = display.length > 1;
  const activeStep = step ?? display[0]?.name;
  // The morph below swaps next/submit for the skip control while a
  // skippable question has nothing picked, so the primary button is always
  // live -- a disabled next beside a separate skip read as a dead end.
  const activeDisplay = display.find(q => q.name === activeStep);
  const activeSkippable =
    activeDisplay !== undefined && !activeDisplay.required;
  const lastStep =
    display.length > 0 && activeStep === display[display.length - 1]!.name;

  const toggle = (
    name: string,
    multiple: boolean,
    value: string,
    checked: boolean
  ) => {
    if (!multiple) {
      onSelectionsChange({ ...selections, [name]: value });
      return;
    }
    const current = selections[name];
    const next = new Set(Array.isArray(current) ? current : []);
    if (checked) next.add(value);
    else next.delete(value);
    onSelectionsChange({ ...selections, [name]: [...next] });
  };

  return (
    <Questionnaire.Root
      className={classes.form}
      items={items}
      shortcuts="numbers"
      item={activeStep}
      onItemChange={onStepChange}
      onSubmit={event => {
        event.preventDefault();
        onSubmitAnswers(
          answersFromForm(gate, new FormData(event.currentTarget))
        );
      }}
    >
      {stepped && (
        <Questionnaire.Progress
          render={(props, state) => (
            <Text
              {...props}
              component="span"
              fz={11}
              fw={500}
              c="dimmed"
              ff="monospace"
              className={classes.progress}
              data-testid="gate-progress"
            >
              {state.current} of {state.total}
            </Text>
          )}
        />
      )}
      {display.map(item => {
        const current = selections[item.name];
        const picked = new Set(Array.isArray(current) ? current : []);
        return (
          <Questionnaire.Item
            key={item.name}
            name={item.name}
            required={item.required}
            multiple={item.multiple}
            className={classes.item}
            data-testid={`gate-item-${item.name}`}
          >
            <Questionnaire.Title className={classes.title}>
              {item.prompt}
            </Questionnaire.Title>
            <Questionnaire.Choices className={classes.choices}>
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
                  className={classes.choice}
                >
                  <Questionnaire.ChoiceInput
                    render={props =>
                      item.multiple ? (
                        <Checkbox
                          {...props}
                          color="accent"
                          size="xs"
                          className={classes.choiceInput}
                        />
                      ) : (
                        <Radio
                          {...props}
                          color="accent"
                          size="xs"
                          className={classes.choiceInput}
                        />
                      )
                    }
                  />
                  <Questionnaire.ChoiceLabel
                    title={choice.description}
                    className={classes.choiceLabel}
                  >
                    <span>{choice.label}</span>
                    {choice.recommended && (
                      <Badge
                        size="xs"
                        variant="light"
                        color="teal"
                        data-testid="gate-recommended"
                      >
                        recommended
                      </Badge>
                    )}
                  </Questionnaire.ChoiceLabel>
                  <Questionnaire.ChoiceShortcut
                    render={(props, state) =>
                      state.shortcut === null ? null : (
                        <Kbd {...props} size="xs" className={classes.key} />
                      )
                    }
                  />
                </Questionnaire.Choice>
              ))}
            </Questionnaire.Choices>
            <Questionnaire.Error
              render={(props, state) =>
                state.invalid ? (
                  <Text {...props} c="bad" fz={12} data-testid="gate-error" />
                ) : null
              }
            />
            <TextInput
              size="xs"
              name={noteFieldName(item.name)}
              aria-label={`Note for ${item.prompt}`}
              placeholder="Add a note"
              value={notes[item.name] ?? ''}
              onChange={event =>
                onNoteChange(item.name, event.currentTarget.value)
              }
              onKeyDown={event => {
                // Plain Enter in a text input is implicit form submission;
                // Cmd/Ctrl+Enter stays the primitive's validate-and-advance.
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey)
                  event.preventDefault();
              }}
              data-testid={`gate-note-${item.name}`}
            />
          </Questionnaire.Item>
        );
      })}
      <Group className={classes.actions} gap="xs" align="center" wrap="wrap">
        <Questionnaire.Previous
          render={(props, state) =>
            state.visible ? (
              <Button
                {...props}
                size="xs"
                variant="default"
                disabled={busy}
                data-testid="gate-previous"
              />
            ) : null
          }
        >
          previous
        </Questionnaire.Previous>
        {stepped && (
          <Button
            size="xs"
            variant="subtle"
            type="reset"
            disabled={busy}
            onClick={onReset}
            data-testid="gate-reset"
          >
            reset
          </Button>
        )}
        <Group gap="xs" ml="auto" align="center">
          {status}
          {focus}
          {/* While a skippable multi has nothing picked, the skip control IS
              the primary button ("next · none" / "submit · none") and
              next/submit render null -- skipping submits an explicit [].
              The primitive hides skip on required items, so required steps
              keep plain next/submit. */}
          <Questionnaire.Skip
            render={(props, state) =>
              state.visible && state.status !== 'answered' ? (
                <Button
                  {...props}
                  size="xs"
                  disabled={busy}
                  data-testid="gate-skip"
                />
              ) : null
            }
          >
            {lastStep ? 'submit · none' : 'next · none'}
          </Questionnaire.Skip>
          <Questionnaire.Next
            render={(props, state) =>
              !state.visible ||
              (activeSkippable && state.status !== 'answered') ? null : (
                <Button
                  {...props}
                  size="xs"
                  disabled={busy || state.status !== 'answered'}
                  data-testid="gate-next"
                />
              )
            }
          >
            next
          </Questionnaire.Next>
          <Questionnaire.Submit
            render={(props, state) =>
              !state.visible ||
              (activeSkippable && state.status !== 'answered') ? null : (
                <Button
                  {...props}
                  size="xs"
                  disabled={busy || state.status !== 'answered'}
                  data-testid="gate-submit"
                />
              )
            }
          >
            {busy ? 'submitting…' : 'submit'}
          </Questionnaire.Submit>
        </Group>
      </Group>
    </Questionnaire.Root>
  );
}
