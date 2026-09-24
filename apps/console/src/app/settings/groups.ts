export type Tier = 'rt' | 'apps' | 'suite';

export interface Group {
  id: string;
  label: string;
  tier: Tier;
  blurb: string;
  match: (key: string) => boolean;
}

export const TIER_LABEL: Record<Tier, string> = {
  rt: 'rt',
  apps: 'Apps',
  suite: 'Suite',
};

const prefix = (p: string) => (key: string) => key.startsWith(p);
const pattern = (re: RegExp) => (key: string) => re.test(key);

/** Order is display order. `match` sets must stay disjoint;
    groups.test.ts checks every registered key lands in exactly one. */
export const GROUPS: Group[] = [
  {
    id: 'agents',
    label: 'Agents',
    tier: 'rt',
    blurb: 'Defaults for every rt agent start that does not pass its own flag.',
    match: prefix('agent.'),
  },
  {
    id: 'worktrees',
    label: 'Worktrees & repos',
    tier: 'rt',
    blurb: 'Where rt finds repos, how worktrees are pooled, and branch sync.',
    match: key =>
      /^rt\.(worktree|repo|branchNaming$|sync$|hooks$|roles$|intercepts$|dopplerTemplate$|gitStatus$|ignoredMrs$)/.test(
        key
      ) || key === 'mattstack.tracking',
  },
  {
    id: 'daemon',
    label: 'Daemon',
    tier: 'rt',
    blurb:
      "The rt daemon's own ports, logs, janitors and snapshot loops. Most need a daemon restart.",
    match: pattern(
      /^rt\.(log|runsPruneDays$|apiPort$|daemonPath$|runaway$|homeSnapshot$|teamSnapshot$|trustedBrowserOrigins$|workspacePrefs$|sdmEnrichment$)/
    ),
  },
  {
    id: 'herd',
    label: 'Herd & panes',
    tier: 'rt',
    blurb: 'When the herd watchdog pokes workers and escalates to you.',
    match: pattern(/^(herd|panes)\./),
  },
  {
    id: 'notifications',
    label: 'Notifications & gates',
    tier: 'rt',
    blurb:
      'Which events raise a desktop notification, and when open gates escalate.',
    match: pattern(/^rt\.(notifications$|notify\.|gates\.)/),
  },
  {
    id: 'commands',
    label: 'Commands',
    tier: 'rt',
    blurb: 'Saved presets, variations and scheduled jobs for rt commands.',
    match: pattern(/^rt\.(variations|presets|cron)$/),
  },
  {
    id: 'board',
    label: 'Board',
    tier: 'apps',
    blurb: 'The MR board.',
    match: prefix('board.'),
  },
  {
    id: 'boxscore',
    label: 'Boxscore',
    tier: 'apps',
    blurb: 'MR scoring and the leaderboard.',
    match: prefix('boxscore.'),
  },
  {
    id: 'chat',
    label: 'Chat',
    tier: 'apps',
    blurb: 'rt chat handles, the viewer, and push alerts.',
    match: prefix('chat.'),
  },
  {
    id: 'deck',
    label: 'Deck',
    tier: 'apps',
    blurb: 'Published apps, access, and the public domain.',
    match: prefix('deck.'),
  },
  {
    id: 'gitq',
    label: 'gitq',
    tier: 'apps',
    blurb: 'Work slots, forges, and the checkout board.',
    match: prefix('gitq.'),
  },
  {
    id: 'suite',
    label: 'Suite-wide',
    tier: 'suite',
    blurb:
      'Team integrations, the roster, install mode, Claude Code plugins and skills.',
    match: key =>
      (/^(mattstack|setup|claude|skills)\./.test(key) &&
        key !== 'mattstack.tracking') ||
      key === 'rt.integrations',
  },
];

export function groupOf(key: string): Group {
  const hit = GROUPS.find(g => g.match(key));
  if (hit) return hit;
  const segment = key.split('.')[0] ?? key;
  return {
    id: segment,
    label: segment,
    tier: 'apps',
    blurb: '',
    match: prefix(`${segment}.`),
  };
}
