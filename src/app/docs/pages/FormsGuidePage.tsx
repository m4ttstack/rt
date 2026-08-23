import { Anchor, List, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';
import { OptionsTable } from '../OptionsTable';

const FORM_CONTAINER_SNIPPET = [
  "import { FormContainer, identifierRegex, useForm, zodResolver } from '@ui/forms';",
  "import { TextInput } from '@ui/core';",
  "import { z } from 'zod';",
  '',
  'const gearItemSchema = z.object({',
  "  name: z.string().min(1, 'Item name is required')",
  "    .regex(identifierRegex, 'Only letters, numbers, and underscores'),",
  '  description: z.string().optional(),',
  '});',
  '',
  'const form = useForm({',
  "  initialValues: { name: '', description: '' },",
  '  validate: zodResolver(gearItemSchema),',
  '});',
  '',
  '<FormContainer form={form} loading={saving} error={saveError}',
  '  onSubmit={values => save(values)}>',
  '  <TextInput label="Item name" {...form.getInputProps(\'name\')} />',
  '  <TextInput label="Description" {...form.getInputProps(\'description\')} />',
  '</FormContainer>',
].join('\n');

const MODAL_FORM_SNIPPET = [
  "import { useModalForm } from '@ui/forms';",
  '',
  'const { open, close } = useModalForm({',
  '  schema: gearItemSchema,',
  "  initialValues: { name: '', description: '' },",
  "  successMessage: 'Gear item added', // notifications.success on resolve",
  "  modalProps: { title: 'Add gear item' },",
  '  onSubmit: async values => {',
  '    // receives schema.parse(values): zod transforms/coercions applied.',
  '    // The modal stays open, showing the loading state, until this resolves;',
  '    // a rejection renders in the form-level error alert instead of closing.',
  '    await saveGearItem(values);',
  '  },',
  '});',
  '',
  '<Button onClick={() =>',
  '  open(form => (',
  '    <TextInput data-autofocus label="Item name"',
  "      {...form.getInputProps('name')} />",
  '  ))',
  '}>',
  '  Add gear item',
  '</Button>',
].join('\n');

// Prop rows transcribed from src/ui/forms/FormContainer.tsx (FormContainerProps).
const FORM_CONTAINER_PROPS = [
  {
    name: 'form',
    type: 'UseFormReturnType',
    note: 'Required. The useForm instance to wire submission up to, typically validated with zodResolver.',
  },
  {
    name: 'onSubmit',
    type: '(values) => void',
    note: 'Required. Called with the already-validated values when submit succeeds.',
  },
  {
    name: 'loading?',
    type: 'boolean',
    note: 'Disables the submit button and shows a loading overlay over the fields. Default false.',
  },
  {
    name: 'error?',
    type: 'ReactNode',
    note: 'Top-level error summarized in a red alert above the submit row (e.g. a failed mutation).',
  },
  {
    name: 'submitLabel?',
    type: 'ReactNode',
    note: "Submit button label; default 'Submit'.",
  },
  {
    name: 'noPadding? / noShadow?',
    type: 'boolean',
    note: 'Paper surface toggles for embedding the form flush inside another surface. Default false.',
  },
  {
    name: 'plain?',
    type: 'boolean',
    note: 'Renders no Paper chrome at all (no surface, shadow, or padding) when something else owns the surface. useModalForm sets it automatically for modal-hosted forms. Default false.',
  },
];

// Option rows transcribed from src/ui/forms/useModalForm.tsx (UseModalFormOptions).
const MODAL_FORM_OPTIONS = [
  {
    name: 'schema',
    type: 'z.ZodType',
    note: 'Required. The zod schema; onSubmit receives schema.parse(values).',
  },
  {
    name: 'initialValues',
    type: 'z.infer<Schema>',
    note: "Required. The form's starting values.",
  },
  {
    name: 'onSubmit',
    type: '(values) => unknown | Promise',
    note: 'Required. Sync or async; the modal stays open (showing loading) until it resolves.',
  },
  {
    name: 'successMessage?',
    type: 'string',
    note: 'Shown via notifications.success once the submission resolves.',
  },
  {
    name: 'modalProps?',
    type: 'Partial<OpenModalOptions>',
    note: "Extra props for the hosting modal (title, size, ...). children and modalId are set internally and can't be overridden.",
  },
];

export function FormsGuidePage() {
  return (
    <DocPage
      title="Forms"
      lead="Mantine's useForm validated by zod (via the re-exported zodResolver), wrapped in FormContainer for the layout and submit wiring every form repeats -- plus useModalForm for forms that live entirely inside a modal."
    >
      <DocSection title="FormContainer">
        <Text size="sm">What you get for free:</Text>
        <List size="sm" spacing={4}>
          <List.Item>
            A Paper surface with a loading overlay and disabled submit while
            loading is true.
          </List.Item>
          <List.Item>
            A top-level error alert (pass error, e.g. a failed mutation
            message).
          </List.Item>
          <List.Item>
            A right-aligned submit row -- onSubmit only fires with
            already-validated values.
          </List.Item>
          <List.Item>
            identifierRegex, the shared &quot;safe identifier&quot; validator
            (letters/digits/underscores, no leading digit) for names, slugs, and
            asset tags.
          </List.Item>
        </List>
        <CodeBlock
          code={FORM_CONTAINER_SNIPPET}
          language="tsx"
          minHeight={470}
        />
        <OptionsTable rows={FORM_CONTAINER_PROPS} />
      </DocSection>

      <DocSection title="Forms in modals: useModalForm">
        <Text size="sm">
          For a form that lives entirely inside a modal, useModalForm owns the
          modal (via @ui/modals), the zod schema, loading state, error display,
          the success notification, and closing on success -- the caller only
          supplies a field renderer. On a valid submit, your onSubmit is called
          with the zod-parsed values (schema.parse(values)), not the raw form
          values, so any zod transforms/coercions/defaults are already applied.
          The hosted FormContainer renders chrome-free (plain) automatically --
          the modal body is the surface, so the form never draws a second
          bordered, shadowed box inside it.
        </Text>
        <CodeBlock code={MODAL_FORM_SNIPPET} language="tsx" minHeight={534} />
        <OptionsTable rows={MODAL_FORM_OPTIONS} />
        <Text size="sm" c="dimmed">
          Reference pages with live demos:{' '}
          <Anchor
            component={Link}
            href={docsPath('components/form-container')}
            size="sm"
            fw={500}
          >
            FormContainer
          </Anchor>{' '}
          (including plain mode) and{' '}
          <Anchor
            component={Link}
            href={docsPath('components/use-modal-form')}
            size="sm"
            fw={500}
          >
            useModalForm
          </Anchor>{' '}
          (which also documents useModalFormSubmit, the submit orchestration
          usable on its own).
        </Text>
      </DocSection>
    </DocPage>
  );
}
