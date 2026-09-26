import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, TwoSchemes } from './catalogue';

const BAR = [7.0, 4.5, 4.8, 7.0] as const;
const SERVES = [
  'every size',
  'display, title, body',
  'meta',
  'small, micro',
] as const;
const SIZE = [15, 14.45, 13.26, 11.9] as const;

function TextRamp() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        return (
          <>
            {t.surfaceRamp.map((surface, s) => (
              <div
                key={s}
                style={{
                  background: surface,
                  padding: 12,
                  borderRadius: 6,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <code style={{ color: t.text.fg }}>surface-{s + 1}</code>
                {t.textRamp.map((hex, i) => (
                  <div
                    key={i}
                    style={{
                      color: hex,
                      fontSize: SIZE[i],
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <span>
                      text-{i + 1} {hex} for {SERVES[i]}
                    </span>
                    <Ratio fg={hex} bg={surface} bar={BAR[i]} />
                  </div>
                ))}
              </div>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Text',
  component: TextRamp,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TextRamp>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
