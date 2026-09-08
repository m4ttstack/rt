import type { ReactNode } from 'react';
import { Stack } from '@mattstack/app-kit/core';
import type { GateSelections } from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  Questionnaire,
  type GateForItems,
} from '@mattstack/gate-kit/react';

/** Mantine-styled layer over the kit's questionnaire adapter. Every visible
    question renders at once (parity with the flat card, not the future
    multi-step triage modal): the primitive is step-shaped and renders every
    non-active Item hidden and inert, so the explicit hidden/inert overrides
    on each Item are what make the flat card possible. The native form is the
    one door to submission: FormData, not component state, builds the answer.
    Every choice is controlled from `selections` so a question that unmounts
    and comes back (the respond collapse) remounts wearing its answer, and
    the FormData the submit reads still mirrors that state exactly. */
export function GateQuestionnaire({
  gate,
  selections,
  onSelectionsChange,
  onSubmitAnswers,
  footer,
}: {
  gate: GateForItems;
  selections: GateSelections;
  onSelectionsChange: (next: GateSelections) => void;
  onSubmitAnswers: (payload: { answers: GateSelections } | null) => void;
  footer: ReactNode;
}) {
  const { items, display } = gateItems(gate, selections);
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
      items={items}
      onSubmit={event => {
        event.preventDefault();
        onSubmitAnswers(
          answersFromForm(gate, new FormData(event.currentTarget))
        );
      }}
    >
      <Stack gap="md">
        {display.map(item => {
          const current = selections[item.name];
          const picked = new Set(Array.isArray(current) ? current : []);
          return (
            <Questionnaire.Item
              key={item.name}
              name={item.name}
              required={item.required}
              multiple={item.multiple}
              hidden={false}
              inert={false}
              style={{ border: 0, margin: 0, padding: 0 }}
            >
              <Questionnaire.Title
                style={{ fontWeight: 600, fontSize: 13, padding: 0 }}
              >
                {item.prompt}
              </Questionnaire.Title>
              <Questionnaire.Choices>
                <Stack gap={6} mt={6}>
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
                      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    >
                      <Questionnaire.ChoiceInput />
                      <Questionnaire.ChoiceLabel
                        title={choice.description}
                        style={{ fontSize: 13 }}
                      >
                        {choice.label}
                      </Questionnaire.ChoiceLabel>
                    </Questionnaire.Choice>
                  ))}
                </Stack>
              </Questionnaire.Choices>
            </Questionnaire.Item>
          );
        })}
        {footer}
      </Stack>
    </Questionnaire.Root>
  );
}
