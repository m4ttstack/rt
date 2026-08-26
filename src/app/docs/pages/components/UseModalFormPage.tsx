import { z } from 'zod';

import { Anchor, Button, Text, TextInput } from '@ui/core';
import { identifierRegex, useModalForm } from '@ui/forms';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { useModalForm } from '@ui/forms';",
  '',
  'const { open, close } = useModalForm({',
  '  schema: gearItemSchema,',
  "  initialValues: { name: '', description: '' },",
  "  successMessage: 'Gear item added',",
  "  modalProps: { title: 'Add gear item' },",
  '  onSubmit: async values => {',
  '    // receives schema.parse(values): zod transforms/coercions applied.',
  '    await saveGearItem(values);',
  '  },',
  '});',
  '',
  '<Button onClick={() =>',
  '  open(form => (',
  '    <>',
  '      <TextInput data-autofocus label="Item name"',
  "        {...form.getInputProps('name')} />",
  '      <TextInput label="Description"',
  "        {...form.getInputProps('description')} />",
  '    </>',
  '  ))',
  '}>',
  '  Add gear item',
  '</Button>;',
].join('\n');

// Rows transcribed from src/ui/forms/useModalForm.tsx (UseModalFormOptions).
const OPTIONS_ROWS = [
  {
    name: 'schema',
    type: 'z.ZodType',
    note: 'Required. The zod schema; a valid submit hands onSubmit schema.parse(values), not the raw form values.',
  },
  {
    name: 'initialValues',
    type: 'z.infer<Schema>',
    note: "Required. The form's starting values.",
  },
  {
    name: 'onSubmit',
    type: '(values) => unknown | Promise<unknown>',
    note: 'Required. Sync or async; the modal stays open (showing the loading state) until it resolves. A rejection renders in the form-level error alert instead of closing.',
  },
  {
    name: 'successMessage?',
    type: 'string',
    note: 'Shown via notifications.success once the submission resolves.',
  },
  {
    name: 'modalProps?',
    type: 'Partial<OpenModalOptions>',
    note: "Extra props for the hosting @ui/modals modal (title, size, ...). children and modalId are set internally and can't be overridden.",
  },
];

// Return shape of useModalForm.
const RETURN_ROWS = [
  {
    name: 'open',
    type: '(fields: (form) => ReactNode) => string',
    note: 'Opens the modal hosting the form. Takes a render function for the fields (called with the internally-created useForm instance) and returns the generated modal id.',
  },
  {
    name: 'close',
    type: '(id: string) => void',
    note: "@ui/modals' close, re-exposed for closing programmatically with the id open returned.",
  },
];

// Rows transcribed from src/ui/forms/useModalFormSubmit.ts
// (UseModalFormSubmitOptions + return).
const SUBMIT_ROWS = [
  {
    name: 'onSubmit',
    type: '(values) => unknown | Promise<unknown>',
    note: 'Required. Performs the actual submission (e.g. a mutation). May be sync or async.',
  },
  {
    name: 'successMessage?',
    type: 'string',
    note: 'Shown via notifications.success once onSubmit resolves. Omit to skip the notification.',
  },
  {
    name: 'onSuccess?',
    type: '() => void',
    note: 'Called once onSubmit resolves (after the success notification, if any) -- e.g. closing a modal.',
  },
  {
    name: 'onError?',
    type: '(error: unknown) => void',
    note: 'Called if onSubmit throws/rejects; the error is also returned as error.',
  },
  {
    name: 'returns',
    type: '{ loading, error, handleSubmit }',
    note: "The in-flight flag, the last failure (cleared on the next submit), and the handler to pass as a form's onSubmit.",
  },
];

const gearItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Item name is required')
    .regex(identifierRegex, 'Only letters, numbers, and underscores'),
  description: z.string().optional(),
});

function UseModalFormDemo() {
  const { open } = useModalForm({
    schema: gearItemSchema,
    initialValues: { name: '', description: '' },
    successMessage: 'Gear item added',
    modalProps: { title: 'Add gear item' },
    onSubmit: async () => {
      // Simulated save: the modal shows its loading state until this
      // resolves, then closes and fires the success notification.
      await new Promise(resolve => setTimeout(resolve, 900));
    },
  });

  return (
    <Button
      variant="light"
      onClick={() =>
        open(form => (
          <>
            <TextInput
              data-autofocus
              label="Item name"
              placeholder="camera_kit"
              {...form.getInputProps('name')}
            />
            <TextInput
              label="Description"
              placeholder="Optional"
              {...form.getInputProps('description')}
            />
          </>
        ))
      }
    >
      Add gear item
    </Button>
  );
}

export function UseModalFormPage() {
  return (
    <ComponentDoc
      title="useModalForm"
      lead="Opens a modal (via @ui/modals) hosting a zod-validated form: the hook owns the modal, the schema, the loading state, the success notification, and closing on success -- the caller only supplies a field renderer."
      demoIntro="Open the modal and submit: empty for the zod errors, valid for a simulated async save (the modal stays open with its loading overlay until it resolves, then closes and notifies)."
      demo={<UseModalFormDemo />}
      usage={USAGE}
      usageMinHeight={620}
      propsTables={[
        { title: 'Options', rows: OPTIONS_ROWS },
        { title: 'Returns', rows: RETURN_ROWS },
        {
          title: 'useModalFormSubmit',
          intro:
            'The submit orchestration underneath (exported from @ui/forms on its own): loading/error state around a possibly-async onSubmit, the success notification, then onSuccess. useModalForm wires its onSuccess to closing the modal; use the hook directly for the same flow outside a modal.',
          rows: SUBMIT_ROWS,
        },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          On a valid submit your onSubmit receives the zod-parsed values
          (schema.parse(values)), so transforms, coercions, and defaults are
          already applied. The hosted FormContainer renders chrome-free (plain)
          automatically -- the modal body is the surface. The fields render
          function receives the form the modal creates internally; mark the
          first field data-autofocus so focus lands in the form when the modal
          opens.
        </Text>
        <Text size="sm" c="dimmed">
          See{' '}
          <Anchor
            component={Link}
            href={docsPath('components/form-container')}
            size="sm"
            fw={500}
          >
            FormContainer
          </Anchor>{' '}
          for the hosted layout,{' '}
          <Anchor component={Link} href={docsPath('forms')} size="sm" fw={500}>
            the Forms guide
          </Anchor>{' '}
          for the full recipe, and{' '}
          <Anchor component={Link} href={docsPath('modals')} size="sm" fw={500}>
            the Modals guide
          </Anchor>{' '}
          for the facade hosting the modal itself.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
