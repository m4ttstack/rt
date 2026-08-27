import { afterEach, expect, test } from 'vitest';

import { Icons } from './Icons';
import {
  __resetAppIconsForTests,
  registerIcons,
  resolveIcon,
} from './registry';
import type { IconComponent } from './types';

const Probe: IconComponent = props => <svg data-testid="probe" {...props} />;

afterEach(() => __resetAppIconsForTests());

test('resolves kit icons without registration', () => {
  expect(resolveIcon('trash')).toBe(Icons.trash);
});

test('resolves an app icon after registration', () => {
  registerIcons({ probe: Probe });
  expect(resolveIcon('probe' as never)).toBe(Probe);
});

test('rejects a key the kit already has', () => {
  expect(() => registerIcons({ trash: Probe })).toThrow(/already/);
});

test('rejects registering the same app key twice', () => {
  registerIcons({ probe: Probe });
  expect(() => registerIcons({ probe: Probe })).toThrow(/already/);
});

test('throws on an unknown name so a typo never renders nothing', () => {
  expect(() => resolveIcon('nope' as never)).toThrow(/Unknown icon/);
});
