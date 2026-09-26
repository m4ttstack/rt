import type { Meta, StoryObj } from '@storybook/react-vite';

import { HUE_SCALE, HUES } from '@mattstack/tokens';
import { RADIX } from '@mattstack/tokens/radix';
import { Ratio, scheme, TwoSchemes } from './catalogue';

function Palette() {
  return (
    <TwoSchemes
      render={name => {
        const t = scheme(name);
        const worstSurface = t.surfaceRamp[3];
        return (
          <>
            {HUES.map(hue => {
              const steps = RADIX[HUE_SCALE[hue]][name];
              const { fill, text } = t.hueStep[hue];
              return (
                <div
                  key={hue}
                  style={{
                    display: 'grid',
                    gap: 6,
                    // The hue text samples below are painted directly on
                    // this block, so it has to be a real surface, not the
                    // story ground.
                    background: t.surface.card,
                    padding: 12,
                    borderRadius: 6,
                  }}
                >
                  <code>
                    {hue} ({HUE_SCALE[hue]}): fill {fill}, text {text}, small 12
                  </code>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {steps.map((hex, i) => {
                      const step = i + 1;
                      const chosen =
                        step === fill || step === text || step === 12;
                      return (
                        <div
                          key={hex}
                          style={{
                            display: 'grid',
                            gap: 2,
                            justifyItems: 'center',
                          }}
                        >
                          <div
                            style={{
                              width: 40,
                              height: chosen ? 40 : 28,
                              background: hex,
                              borderRadius: 3,
                              outline: chosen
                                ? `2px solid ${t.text.fg}`
                                : 'none',
                            }}
                          />
                          <span style={{ fontSize: 10 }}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <span>
                      fill {t.hue[hue]}{' '}
                      <Ratio fg={t.hue[hue]} bg={worstSurface} bar={3.0} />
                    </span>
                    <span style={{ color: t.hueText[hue] }}>
                      text {t.hueText[hue]}{' '}
                      <Ratio fg={t.hueText[hue]} bg={worstSurface} bar={4.5} />
                    </span>
                    <span
                      style={{ color: t.hueTextSmall[hue], fontSize: 11.9 }}
                    >
                      small {t.hueTextSmall[hue]}{' '}
                      <Ratio
                        fg={t.hueTextSmall[hue]}
                        bg={worstSurface}
                        bar={7.0}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        );
      }}
    />
  );
}

const meta = {
  title: 'Tokens/Palette',
  component: Palette,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Palette>;

export default meta;

export const RadixSteps: StoryObj<typeof meta> = {};
