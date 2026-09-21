import type { Meta, StoryObj } from '@storybook/react-vite';

const STEPS = [
  {
    name: 'display',
    px: 17,
    weight: 700,
    line: 1.25,
    bar: 4.5,
    token: '--text-2',
  },
  {
    name: 'title',
    px: 15.3,
    weight: 600,
    line: 1.3,
    bar: 4.5,
    token: '--text-2',
  },
  {
    name: 'body',
    px: 14.45,
    weight: 400,
    line: 1.5,
    bar: 4.5,
    token: '--text-2',
  },
  {
    name: 'meta',
    px: 13.26,
    weight: 400,
    line: 1.45,
    bar: 4.8,
    token: '--text-3',
  },
  {
    name: 'small',
    px: 11.9,
    weight: 400,
    line: 1.4,
    bar: 7.0,
    token: '--text-4',
  },
  {
    name: 'micro',
    px: 10.54,
    weight: 500,
    line: 1.35,
    bar: 7.0,
    token: '--text-4',
  },
] as const;

function TypeRamp() {
  return (
    <div
      style={{
        background: 'var(--card)',
        color: 'var(--fg)',
        padding: 20,
        display: 'grid',
        gap: 10,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STEPS.map(s => (
        <div
          key={s.name}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 1fr',
            gap: 16,
            alignItems: 'baseline',
          }}
        >
          <code style={{ fontSize: 12 }}>{s.name}</code>
          <span
            style={{
              fontSize: `var(--type-${s.name})`,
              fontWeight: s.weight,
              lineHeight: s.line,
            }}
          >
            The quick brown fox at {s.px}px
          </span>
          <span
            style={{
              fontSize: `var(--type-${s.name})`,
              fontWeight: s.weight,
              lineHeight: s.line,
              color: `var(${s.token})`,
            }}
          >
            secondary text takes {s.token} ({s.bar}:1)
          </span>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: 'Tokens/Type',
  component: TypeRamp,
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta<typeof TypeRamp>;

export default meta;

export const Steps: StoryObj<typeof meta> = {};
