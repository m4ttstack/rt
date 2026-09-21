import type { Meta, StoryObj } from '@storybook/react-vite';

import { Ratio, scheme, TwoSchemes } from './catalogue';

const ROLES = [
  'border',
  'soft',
  'control',
  'edgeOnCard',
  'softOnCard',
] as const;

function Lines() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        const ground = name === 'light' ? t.surfaceRamp[0] : t.surface.card;
        return (
          <>
            {t.lineRamp.map((hex, i) => (
              <div
                key={i}
                style={{
                  background: ground,
                  padding: 12,
                  borderRadius: 6,
                  border: `1px solid ${hex}`,
                  display: 'grid',
                  gap: 4,
                }}
              >
                <span>
                  line-{i + 1} <code>{hex}</code>
                </span>
                <span>
                  against {name === 'light' ? 'surface-1' : 'card'}:{' '}
                  <Ratio fg={hex} bg={ground} />
                </span>
                <span>
                  roles:{' '}
                  {ROLES.filter(r => t.lineRole[r] === i + 1).join(', ') ||
                    'none'}
                </span>
              </div>
            ))}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Lines',
  component: Lines,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Lines>;

export default meta;

export const Ramp: StoryObj<typeof meta> = {};
