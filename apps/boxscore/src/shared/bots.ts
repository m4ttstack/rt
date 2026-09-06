/**
 * Built-in bot username patterns: one list feeding metric filtering (isBotUsername),
 * the suspected-bot scanner, and the settings-page badges. GitLab service accounts
 * (resource access tokens, group/project bots, CI bots) comment automatically and
 * would otherwise skew review metrics.
 */
export const BUILTIN_BOT_PATTERNS: readonly { source: string; labels: readonly string[] }[] = [
  { source: "^(project|group)_\\d+_bot", labels: ["project_N_bot", "group_N_bot"] },
  { source: "_bot_", labels: ["*_bot_*"] },
  { source: "_bot$", labels: ["*_bot"] },
  { source: "^ghost$", labels: ["ghost"] },
];

/** Display forms for the settings page. */
export const BUILTIN_BOT_PATTERN_LABELS: readonly string[] = BUILTIN_BOT_PATTERNS.flatMap(
  (p) => p.labels,
);
