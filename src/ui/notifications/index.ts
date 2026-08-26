export { notifications } from './notifications';
export type { NotificationType, ShowNotificationProps } from './notifications';
export { TimedRingProgress } from './TimedRingProgress';
export type { TimedRingProgressProps } from './TimedRingProgress';

// Re-export the rest of @mantine/notifications (the `Notifications` provider
// component, `useNotifications`, etc). @mantine/notifications itself exports
// a `notifications` object too. Per the ES module spec, a star-export never
// overrides a name the module also exports explicitly -- the local
// `export { notifications } from './notifications'` above always wins,
// regardless of statement order. Same pattern as @ui/modals; verified by
// notifications.test.tsx: if mantine's plain `notifications` (no
// `.success`/`.error`/etc) were shadowing ours, the per-level helpers used
// there would throw at runtime instead of showing a notification.
export * from '@mantine/notifications';
