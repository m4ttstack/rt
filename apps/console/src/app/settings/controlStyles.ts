const MONO = 'var(--mantine-font-family-monospace)';
// Mantine's placeholder grey is off the Tokyo ramp and reads as a value.
export const PLACEHOLDER = { '--input-placeholder-color': 'var(--tk-text-3)' };

/** Tokyo's dense font ladder puts an xs input at about 10.5px; the settings
    rows set their control type in px so it reads at the design's 12 and 14. */
export const INPUT_TYPE = {
  label: { input: { ...PLACEHOLDER, fontSize: 14 } },
  number: { input: { ...PLACEHOLDER, fontSize: 14, fontFamily: MONO } },
  code: { input: { ...PLACEHOLDER, fontSize: 12, fontFamily: MONO } },
} as const;

export const SWITCH_SIZE = {
  '--switch-height': '18px',
  '--switch-width': '34px',
} as const;

export function enumWidth(options: readonly string[]): number {
  const longest = Math.max(0, ...options.map(o => o.length));
  return Math.min(200, Math.max(120, longest * 8 + 60));
}

export function numberWidth(value: unknown): number {
  return typeof value === 'number' && Math.abs(value) >= 1000 ? 90 : 72;
}
