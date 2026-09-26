import { expect, test } from 'vitest';

import { HUMAN_HANDLE } from './human';
import { speakerHue } from './speaker-hue';

test('the same handle always gets the same hue', () => {
  expect(speakerHue('fox')).toEqual(speakerHue('fox'));
  expect(speakerHue('deck-main')).toEqual(speakerHue('deck-main'));
});

test('the human handle always gets accent, never a rotation hue', () => {
  expect(speakerHue(HUMAN_HANDLE)).toEqual({
    text: 'var(--mantine-color-accent-text)',
    fill: 'var(--tk-fill-accent)',
  });
});

test('fox and max land on different hues, the motivating near-collision case', () => {
  expect(speakerHue('fox').text).not.toBe(speakerHue('max').text);
});

test('a passed humanHandle owns accent; the default matt then takes a rotation hue', () => {
  expect(speakerHue('fox', 'fox').text).toBe(
    'var(--mantine-color-accent-text)'
  );
  expect(speakerHue('matt', 'fox').text).not.toBe(
    'var(--mantine-color-accent-text)'
  );
});

test('fill never changes with band; the purple/cyan text steps do', () => {
  const handles = ['fox', 'max', 'deck-main', 'edie', 'jay', 'jules', 'wren'];
  for (const handle of handles) {
    expect(speakerHue(handle, undefined, 'body').fill).toBe(
      speakerHue(handle).fill
    );
  }
  // At least one of these handles must land on the purple/cyan slots for
  // the band to be exercised at all; if none do, widen the sample above.
  expect(
    handles.some(
      handle =>
        speakerHue(handle).text !== speakerHue(handle, undefined, 'body').text
    )
  ).toBe(true);
});
