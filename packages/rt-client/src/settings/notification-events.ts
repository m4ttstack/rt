/**
 * The desktop notification categories rt can send, in registry form. The
 * daemon's own list (lib/notifier.ts NOTIFICATION_TYPES) and settings-kit's
 * NOTIFICATION_EVENTS mirror this; lib/__tests__/notification-shape-parity
 * fails when any of the three drifts.
 *
 * Every category defaults to on: an unset preference sends. The registry
 * default carries that, so anything rendering the effective value (the
 * console's toggles) shows an unset category the way the daemon treats it.
 */
export const NOTIFICATION_EVENT_KEYS = [
  "pipeline_failed", "pipeline_passed", "mr_approved", "mr_merged", "mr_closed", "mr_ready",
  "merge_conflicts", "needs_rebase", "merge_error", "new_comment", "stale_port", "runaway_process",
  "evidence_batch_ready", "evidence_failed", "chat_mention", "credential_health", "member_joined",
  "worktree_triage",
] as const;

export const NOTIFICATION_DEFAULTS: Readonly<Record<(typeof NOTIFICATION_EVENT_KEYS)[number], boolean>> = Object.freeze(
  Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, true])) as Record<(typeof NOTIFICATION_EVENT_KEYS)[number], boolean>,
);
