import type { Meta, StoryObj } from '@storybook/react-vite';

import { HUES } from '@mattstack/tokens';
import { Button } from '@mattstack/tui-kit';

const INTENTS = [
  'accent',
  'ok',
  'warn',
  'bad',
  'cyan',
  'purple',
  'muted',
] as const;
const VARIANTS = ['default', 'filled', 'light', 'outline', 'subtle'] as const;
const SURFACES = [
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-4',
] as const;

function ButtonWall() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SURFACES.map(surface => (
        <div
          key={surface}
          style={{
            background: `var(${surface})`,
            padding: 16,
            borderRadius: 8,
            display: 'grid',
            gap: 8,
          }}
        >
          <code style={{ color: 'var(--text-3)', fontSize: 12 }}>
            {surface}
          </code>
          {VARIANTS.map(variant => (
            <div
              key={variant}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            >
              {INTENTS.map(intent => (
                <Button key={intent} intent={intent} variant={variant}>
                  {intent}
                </Button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TextWall() {
  const texts = ['--text-1', '--text-2', '--text-3', '--text-4'] as const;
  const sizes = {
    '--text-1': 14.45,
    '--text-2': 14.45,
    '--text-3': 13.26,
    '--text-4': 11.9,
  } as const;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SURFACES.map(surface => (
        <div
          key={surface}
          style={{
            background: `var(${surface})`,
            padding: 16,
            borderRadius: 8,
            display: 'grid',
            gap: 6,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {texts.map(text => (
            <p
              key={text}
              style={{
                margin: 0,
                color: `var(${text})`,
                fontSize: sizes[text],
              }}
            >
              {text} on {surface}: Inventory counts pause on Friday; items on
              loan keep their due dates.
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Gold has no Button intent (its fill measures 1.29 against the tightest
 * light surface, so a filled gold button would not separate from the page)
 * and no Badge or Chip intent either, since both share the Button family
 * map. This is the only place in the wall the seventh hue appears: its raw
 * fill/on-fill pairing and its vivid text step, the two tokens no button,
 * chip or badge specimen exercises.
 */
function HueWall() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {HUES.map(hue => (
          <span
            key={hue}
            style={{
              background: `var(--fill-${hue})`,
              color: `var(--on-fill-${hue})`,
              padding: '6px 14px',
              borderRadius: 999,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
            }}
          >
            {hue}
          </span>
        ))}
      </div>
      {SURFACES.map(surface => (
        <div
          key={surface}
          style={{
            background: `var(${surface})`,
            padding: 16,
            borderRadius: 8,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {HUES.map(hue => (
            <span
              key={hue}
              style={{ color: `var(--text-${hue}-vivid)`, fontSize: 13 }}
            >
              {hue} status: pickup window closes at 5.
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: 'Specimens/tui-kit',
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta;

export default meta;

export const Buttons: StoryObj = { render: () => <ButtonWall /> };
export const Text: StoryObj = { render: () => <TextWall /> };
export const Hues: StoryObj = { render: () => <HueWall /> };
