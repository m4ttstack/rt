export type { ConfirmLabels, ConfirmOptions } from './confirm';
export { modals } from './modals';
export type { OpenModalOptions } from './modals';
export type { PromptOptions } from './prompt';

// Re-export the rest of @mantine/modals (ModalsProvider, useModals, etc).
// NOTE: @mantine/modals itself exports a `modals` object too. Per the ES
// module spec, a star-export never overrides a name the module also exports
// explicitly -- the local `export { modals } from './modals'` above always
// wins, regardless of statement order. Verified by modals.test.tsx: if
// mantine's `modals` (which has no `.confirm`/`.prompt`) were shadowing ours,
// `modals.confirm(...)` would throw at runtime instead of opening a modal.
export * from '@mantine/modals';
