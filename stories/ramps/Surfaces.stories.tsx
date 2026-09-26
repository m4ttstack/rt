import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, Swatch, TwoSchemes } from './catalogue';

const ROLES = ['card', 'panel', 'page', 'chrome', 'inset', 'overlay'] as const;

function Surfaces() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        return (
          <>
            {t.surfaceRamp.map((hex, i) => (
              <Swatch
                key={hex}
                hex={hex}
                label={`surface-${i + 1}`}
                textOn={t.text.fg}
              >
                <span>
                  text-1 on it: <Ratio fg={t.text.fg} bg={hex} />
                </span>
                <span>
                  roles:{' '}
                  {ROLES.filter(r => t.surfaceRole[r] === i + 1).join(', ') ||
                    'none'}
                </span>
              </Swatch>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Surfaces',
  component: Surfaces,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Surfaces>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
