export * from '@mantine/hooks';

// Named exports below win over the `export *` above for any colliding name
// (e.g. useLocalStorage/useSessionStorage) -- every shadow MUST be a named
// export here, not folded into another `export *`.
export { useLocalStorage, useSessionStorage } from './useStorage';
export type { StorageHookProps } from './useStorage';

export {
  useColorScheme,
  useStoredColorScheme,
  useLightDark,
} from './useColorScheme';

export { useUIState, useStoredUIState } from './useUIState';
export type { UIState } from './useUIState';

export { useIsMobile } from './useIsMobile';
export { useHasOverflowX } from './useHasOverflowX';
export { useHoverableTextStyle } from './useHoverableTextStyle';

export { staticSchemeColors, useSchemeColors } from './useSchemeColors';
