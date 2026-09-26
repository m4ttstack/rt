/**
 * tui-kit's intent vocabulary, minus the intents that collide with Mantine
 * built-ins. Naming them identically on both sides is what lets a component
 * written against `color="ok"` survive a move to tui-kit unedited.
 */
export type TokyoColorName =
  | 'accent'
  | 'ok'
  | 'warn'
  | 'bad'
  | 'purple'
  // The per-scheme ramps behind those virtual colors. They are registered as
  // theme colors in their own right because `virtualColor` resolves its two
  // sides by NAME out of the same map, which also makes them addressable on a
  // color prop. Reach for the scheme-aware name, never a Day/Night half.
  | 'accentDay'
  | 'accentNight'
  | 'okDay'
  | 'okNight'
  | 'warnDay'
  | 'warnNight'
  | 'badDay'
  | 'badNight'
  | 'purpleDay'
  | 'purpleNight'
  | 'cyanDay'
  | 'cyanNight';
