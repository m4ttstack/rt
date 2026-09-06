import { expect, test } from 'vitest';

import { HUMAN_HANDLE } from './human';
import { speakerHue } from './speaker-hue';

test('the same handle always gets the same hue', () => {
  expect(speakerHue('fox')).toBe(speakerHue('fox'));
  expect(speakerHue('deck-main')).toBe(speakerHue('deck-main'));
});

test('the human handle always gets accent, never a rotation hue', () => {
  expect(speakerHue(HUMAN_HANDLE)).toBe('var(--mantine-color-accent-text)');
});

test('fox and max land on different hues, the motivating near-collision case', () => {
  expect(speakerHue('fox')).not.toBe(speakerHue('max'));
});

test('a passed humanHandle owns accent; the default matt then takes a rotation hue', () => {
  expect(speakerHue('fox', 'fox')).toBe('var(--mantine-color-accent-text)');
  expect(speakerHue('matt', 'fox')).not.toBe(
    'var(--mantine-color-accent-text)'
  );
});
