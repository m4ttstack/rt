/**
 * tui-kit's intent vocabulary, minus the intents that collide with Mantine
 * built-ins. Naming them identically on both sides is what lets a component
 * written against `color="ok"` survive a move to tui-kit unedited.
 */
export type AppCustomColors = 'accent' | 'ok' | 'warn' | 'bad' | 'purple';
