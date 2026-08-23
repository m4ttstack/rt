import { Anchor, Button, Group, Text } from '@ui/core';
import { modals } from '@ui/modals';
import { notifications } from '@ui/notifications';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';
import { OptionsTable } from '../OptionsTable';

const CONFIRM_SNIPPET = [
  "import { modals } from '@ui/modals';",
  '',
  'modals.confirm({',
  "  title: 'Remove gear item',",
  '  message: `Remove "${name}"? This can\'t be undone.`,',
  '  destructive: true, // warning icon + red confirm button',
  '  onConfirm: () => removeItem(name),',
  '});',
].join('\n');

const PROMPT_SNIPPET = [
  'modals.prompt({',
  '  title: `Rename "${name}"`,',
  "  label: 'New name',",
  "  placeholder: 'letters, numbers, underscores',",
  '  required: true,',
  '  initialValue: name,',
  '  validate: value =>',
  "    identifierRegex.test(value) ? null : 'Only letters, numbers, and underscores are allowed',",
  '  onSubmit: newName => rename(newName),',
  '});',
].join('\n');

// Option rows transcribed from src/ui/modals/confirm.tsx (ConfirmOptions).
const CONFIRM_OPTIONS = [
  {
    name: 'title',
    type: 'ReactNode',
    note: 'Required. Bold title row; gains a warning icon when destructive.',
  },
  {
    name: 'message',
    type: 'ReactNode',
    note: 'Required. Strings render as sized Text automatically.',
  },
  {
    name: 'destructive?',
    type: 'boolean',
    note: 'Warning icon next to the title and a red confirm button.',
  },
  {
    name: 'hideCancelButton?',
    type: 'boolean',
    note: 'Removes the cancel button entirely (not just disabled).',
  },
  {
    name: 'onConfirm',
    type: '() => void',
    note: 'Required. Called when the confirm button is clicked.',
  },
  {
    name: 'onCancel?',
    type: '() => void',
    note: 'Called when the modal is cancelled.',
  },
  {
    name: 'labels?',
    type: '{ confirm?, cancel? }',
    note: "Button labels; default 'Confirm' / 'Cancel'.",
  },
  {
    name: 'confirmProps? / cancelProps?',
    type: 'ButtonProps',
    note: "Button overrides. Cancel defaults to a quiet color:'gray' variant:'light'; destructive adds color:'red' to confirm.",
  },
  {
    name: '...rest',
    type: 'OpenConfirmModal',
    note: 'Any other @mantine/modals option passes through (size, modalId, closeOnConfirm, ...).',
  },
];

// Option rows transcribed from src/ui/modals/prompt.tsx (PromptOptions).
const PROMPT_OPTIONS = [
  { name: 'title', type: 'ReactNode', note: 'Required. Modal title.' },
  { name: 'message?', type: 'ReactNode', note: 'Rendered above the input.' },
  {
    name: 'label?',
    type: 'ReactNode',
    note: 'Label rendered above the text input.',
  },
  {
    name: 'placeholder?',
    type: 'string',
    note: "The input's placeholder.",
  },
  {
    name: 'required?',
    type: 'boolean',
    note: 'Asterisk on the label; empty/whitespace submits are rejected with "Value is required" (validate still runs first).',
  },
  {
    name: 'initialValue?',
    type: 'string',
    note: "Input's starting value; default ''.",
  },
  {
    name: 'validate?',
    type: '(value) => string | null',
    note: 'Return an error message to block submit, null to pass.',
  },
  {
    name: 'onSubmit',
    type: '(value) => void | Promise<unknown>',
    note: 'Required. Called with the value on a valid submit. Return a promise to show the button loading + disable the input until it settles; the modal closes when it does.',
  },
  {
    name: 'confirmLabel?',
    type: 'ReactNode',
    note: "Submit button label. Default 'Submit'.",
  },
  {
    name: 'confirmProps?',
    type: 'ButtonProps',
    note: 'Extra props for the submit button.',
  },
  {
    name: '...rest',
    type: 'ModalSettings',
    note: 'Any other @mantine/modals option passes through (size, ...).',
  },
];

function tryConfirm() {
  modals.confirm({
    title: 'Remove gear item',
    message:
      'This is the kit’s confirm modal with destructive: true -- nothing actually gets removed.',
    destructive: true,
    onConfirm: () =>
      notifications.success('Confirmed -- this toast is notifications.success'),
  });
}

function tryPrompt() {
  modals.prompt({
    title: 'Rename "camera_kit"',
    label: 'New name',
    placeholder: 'letters, numbers, underscores',
    required: true,
    initialValue: 'camera_kit',
    onSubmit: newName => {
      notifications.info(
        `Renamed to ${newName} (not really -- this is a live doc)`
      );
    },
  });
}

export function ModalsPage() {
  return (
    <DocPage
      title="Modals"
      lead="The @ui/modals facade keeps the shape of @mantine/modals -- modals.open/close/closeAll are typed pass-throughs -- and adds two higher-level helpers on top: modals.confirm and modals.prompt."
    >
      <DocSection title="Try it live">
        <Text size="sm">
          These buttons are live docs, wired to the real facade:
        </Text>
        <Group gap="sm">
          <Button variant="light" onClick={tryConfirm}>
            Try modals.confirm
          </Button>
          <Button variant="light" onClick={tryPrompt}>
            Try modals.prompt
          </Button>
        </Group>
      </DocSection>

      <DocSection title="modals.confirm">
        <Text size="sm">
          A yes/no decision modal. destructive: true renders a warning icon next
          to the title and a red confirm button; hideCancelButton: true removes
          the cancel button entirely rather than just disabling it.
        </Text>
        <CodeBlock code={CONFIRM_SNIPPET} language="tsx" minHeight={192} />
        <OptionsTable rows={CONFIRM_OPTIONS} />
      </DocSection>

      <DocSection title="modals.prompt">
        <Text size="sm">
          A one-field input modal: autofocused TextInput, inline validation,
          submit on Enter. The modal closes itself only when validation passes.
        </Text>
        <CodeBlock code={PROMPT_SNIPPET} language="tsx" minHeight={172} />
        <OptionsTable rows={PROMPT_OPTIONS} />
      </DocSection>

      <DocSection title="Everything else: modals.open">
        <Text size="sm">
          For anything beyond a confirm or a prompt, modals.open is a typed
          pass-through to @mantine/modals&apos; openModal -- arbitrary children,
          title, size, and the rest of the modal surface. A form that lives
          entirely inside a modal has its own dedicated helper,{' '}
          <Anchor
            component={Link}
            href={docsPath('components/use-modal-form')}
            size="sm"
            fw={500}
          >
            useModalForm
          </Anchor>
          , with the recipe also walked in the Forms guide.
        </Text>
      </DocSection>
    </DocPage>
  );
}
