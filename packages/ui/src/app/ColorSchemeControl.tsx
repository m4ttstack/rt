import { HybridMenu, RailEntry } from '@mattstack/app-kit/core';
import { useColorScheme } from '@mattstack/app-kit/hooks';

type ColorSchemePreference = 'auto' | 'light' | 'dark';

const OPTIONS: { label: string; value: ColorSchemePreference }[] = [
  { label: 'System', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export function ColorSchemeControl({ expanded }: { expanded: boolean }) {
  const { colorScheme, computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';
  return (
    <HybridMenu
      options={OPTIONS}
      value={colorScheme}
      onChange={value => setColorScheme(value as ColorSchemePreference)}
      target={
        <RailEntry
          icon={isDark ? 'sun' : 'moon'}
          label="Color scheme"
          expanded={expanded}
        />
      }
    />
  );
}
