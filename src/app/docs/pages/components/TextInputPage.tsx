import { Stack, Text, TextInput } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { TextInput } from '@ui/core';",
  '',
  '// The kit default: browser autofill suggestions stay out of the way.',
  '<TextInput label="Asset tag" placeholder="camera_kit" />;',
  '',
  '// Real identity fields opt back in per field with a specific token:',
  '<TextInput label="Email" autoComplete="email" />;',
  '<TextInput label="Password" type="password" autoComplete="current-password" />;',
].join('\n');

// Rows transcribed from src/ui/core/text-input/TextInput.tsx (TextInputProps
// = Mantine's own TextInputProps, unchanged).
const PROPS_ROWS = [
  {
    name: 'autoComplete?',
    type: 'string',
    note: "Kit-layered default: 'off'. Pass any value to override -- 'on', or better a specific token ('email', 'current-password', 'name', ...) on fields where autofill is genuinely wanted.",
  },
  {
    name: 'onTextChange?',
    type: '(value: string) => void',
    note: 'Convenience over onChange: called with just the new string. Fires alongside (and after) any onChange you also pass.',
  },
  {
    name: 'forceUpperCase?',
    type: 'boolean',
    note: 'Uppercases input as it is typed. Default false.',
  },
  {
    name: '...rest',
    type: 'MantineTextInputProps',
    note: "Everything else is Mantine's TextInput surface, unchanged: label, description, error, leftSection/rightSection, size, radius, and the rest.",
  },
  {
    name: 'ref',
    type: 'Ref<HTMLInputElement>',
    note: 'Forwards to the underlying input element.',
  },
];

function TextInputDemo() {
  return (
    <Stack gap="sm" maw={360}>
      <TextInput
        label="Asset tag"
        placeholder="camera_kit"
        description="Kit default: autoComplete is off, so the browser stays quiet here."
      />
      <TextInput
        label="Contact email"
        placeholder="you@example.com"
        autoComplete="email"
        description='Opted back in with autoComplete="email" -- the browser may offer saved addresses.'
      />
    </Stack>
  );
}

export function TextInputPage() {
  return (
    <ComponentDoc
      title="TextInput"
      lead="The kit's TextInput shadow: the same component and props as Mantine's, with one kit-wide default layered on -- autoComplete='off' -- on the theory that browser autofill is noise on most app fields (identifiers, search boxes, internal names)."
      demoIntro="Two live fields: the kit default (no autofill suggestions), and a field opted back into browser autofill with a specific token."
      demo={<TextInputDemo />}
      usage={USAGE}
      usageMinHeight={230}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="What the shadow changes">
        <Text size="sm">
          Exactly one thing: autoComplete defaults to &apos;off&apos; instead of
          the browser deciding. That is a real behavior change when porting
          existing forms -- fields that used to autofill silently stop. Opt back
          in per field where autofill is actually wanted:
          autoComplete=&quot;on&quot;, or better, a specific token
          (&quot;email&quot;, &quot;current-password&quot;, ...) on real
          login/signup/profile fields. Size and radius are deliberately NOT
          re-specified here -- they already follow the kit theme&apos;s
          defaultRadius and component defaults, so every input stays consistent
          without the shadow re-asserting them.
        </Text>
        <Text size="sm">
          This is a shadow: importing TextInput from @ui/core gets this
          component, and the import wall bans reaching for Mantine&apos;s
          original by name anywhere in src/ (the shadow definition file itself
          is the one sanctioned exception). FormContainer&apos;s own form
          element also sets autoComplete=&quot;off&quot;, so kit forms are quiet
          by default at both levels.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
