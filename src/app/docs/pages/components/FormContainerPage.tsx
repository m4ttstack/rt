import { useRef, useState } from 'react';
import { z } from 'zod';

import { Anchor, Stack, Switch, Text, TextInput } from '@ui/core';
import {
  FormContainer,
  identifierRegex,
  useForm,
  zodResolver,
} from '@ui/forms';
import { notifications } from '@ui/notifications';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { z } from 'zod';",
  '',
  "import { TextInput } from '@ui/core';",
  "import { FormContainer, identifierRegex, useForm, zodResolver } from '@ui/forms';",
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
  '</FormContainer>;',
].join('\n');

// Rows transcribed from src/ui/forms/FormContainer.tsx (FormContainerProps).
const PROPS_ROWS = [
  {
    name: 'form',
    type: 'UseFormReturnType<Values>',
    note: 'Required. The useForm instance to wire submission up to, typically validated with zodResolver(schema).',
  },
  {
    name: 'onSubmit',
    type: '(values: Values) => void',
    note: "Required. Called with the form's already-validated values when submit succeeds (invalid submits render field errors instead).",
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
    note: "Submit button label. Default 'Submit'.",
  },
  {
    name: 'noPadding? / noShadow?',
    type: 'boolean',
    note: 'Paper surface toggles (from the shared FormStyle type). Both default true (flat) -- opt into padding/shadow by setting either false. Moot when plain is set.',
  },
  {
    name: 'hideChrome?',
    type: 'boolean',
    note: 'Skips the built-in error Alert and submit-button row so you supply your own in children. Default false.',
  },
  {
    name: 'plain?',
    type: 'boolean',
    note: 'Renders no Paper chrome at all -- no surface, shadow, or padding -- for forms hosted inside a surface something else owns (most commonly a modal body; useModalForm sets it automatically). Default false.',
  },
  {
    name: 'children',
    type: 'ReactNode',
    note: "The fields, each wired via form.getInputProps('field').",
  },
];

const gearItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Item name is required')
    .regex(identifierRegex, 'Only letters, numbers, and underscores'),
  description: z.string().optional(),
});

function FormContainerDemo() {
  const form = useForm({
    initialValues: { name: '', description: '' },
    validate: zodResolver(gearItemSchema),
  });
  const [saving, setSaving] = useState(false);
  const [plain, setPlain] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (values: { name: string; description?: string }) => {
    setSaving(true);
    timer.current = setTimeout(() => {
      setSaving(false);
      notifications.success(`Saved ${values.name}`);
      form.reset();
    }, 900);
  };

  return (
    <Stack gap="sm">
      <Switch
        label="plain (no Paper chrome -- how useModalForm hosts it)"
        checked={plain}
        onChange={event => setPlain(event.currentTarget.checked)}
      />
      <FormContainer form={form} onSubmit={save} loading={saving} plain={plain}>
        <TextInput
          label="Item name"
          placeholder="camera_kit"
          {...form.getInputProps('name')}
        />
        <TextInput
          label="Description"
          placeholder="Optional"
          {...form.getInputProps('description')}
        />
      </FormContainer>
    </Stack>
  );
}

export function FormContainerPage() {
  return (
    <ComponentDoc
      title="FormContainer"
      lead="Layout + submit wiring shared by every kit form: a Paper surface, a <form> wired to form.onSubmit, a loading overlay while submitting, the field children, a top-level error summary, and a submit row."
      demoIntro="A live form: submit empty for the zod field errors, or with a valid name (letters/digits/underscores) for a simulated save with the loading overlay. The switch shows plain mode, where the Paper chrome disappears."
      demo={<FormContainerDemo />}
      usage={USAGE}
      usageMinHeight={560}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Standalone vs. plain">
        <Text size="sm">
          Standalone forms keep the Paper surface (padding lg, shadow sm). A
          form living inside a surface that something else provides should pass
          plain to skip the chrome entirely -- the modal-form path does that
          automatically, so a modal form never draws a second bordered, shadowed
          box inside the modal&apos;s own. Even in plain mode a positioned Box
          wrapper remains, so the LoadingOverlay has an ancestor to fill. The
          form element itself sets autoComplete=&quot;off&quot;, matching the
          TextInput shadow&apos;s kit default.
        </Text>
        <Text size="sm" c="dimmed">
          zodResolver and identifierRegex ship from @ui/forms alongside this
          component; the{' '}
          <Anchor component={Link} href={docsPath('forms')} size="sm" fw={500}>
            Forms guide
          </Anchor>{' '}
          walks the full recipe, and{' '}
          <Anchor
            component={Link}
            href={docsPath('components/use-modal-form')}
            size="sm"
            fw={500}
          >
            useModalForm
          </Anchor>{' '}
          covers the modal-hosted flow.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
