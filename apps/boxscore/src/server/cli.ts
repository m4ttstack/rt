/**
 * Headless, JSON-driven entry point ... the same pipeline the HTTP server uses, with no
 * UI. Lets the data + classification be run and evaluated from the terminal.
 *
 *   bun server/cli.ts --range 30d                 # ranked standings table
 *   bun server/cli.ts --range 7d --trend          # include trend deltas
 *   bun server/cli.ts --range 30d --format json   # raw response JSON
 *   bun server/cli.ts --range 30d --format validate --refresh   # run the evaluator (exit 1 on error)
 *   bun server/cli.ts --detail owen-at-acme --range 30d       # per-stat evidence for one person
 *   bun server/cli.ts --format bots                              # scan the whole store for suspected bots
 */
import {
  formatValue as fmt,
  metricByKey,
  metricRank,
  METRICS,
  metricValue,
} from '../shared/metrics.js';
import type {
  LeaderboardResponse,
  MetricKey,
  UserDetailResponse,
} from '../shared/types.js';
import { scanSuspectedBots } from './bots.js';
import { readSettings } from './config/index.js';
import { getLeaderboard, getUserDetail } from './leaderboard.js';
import { validateLeaderboard } from './metrics/validate.js';
import { resolveWindowArgs } from './util/window.js';

interface Args {
  range: string;
  start?: string;
  end?: string;
  trend: boolean;
  refresh: boolean;
  format: 'table' | 'json' | 'validate' | 'bots';
  detail?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    range: readSettings().defaultRange,
    trend: false,
    refresh: false,
    format: 'table',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--range') a.range = argv[++i] ?? a.range;
    else if (arg === '--start') a.start = argv[++i];
    else if (arg === '--end') a.end = argv[++i];
    else if (arg === '--trend') a.trend = true;
    else if (arg === '--refresh') a.refresh = true;
    else if (arg === '--format')
      a.format = (argv[++i] as Args['format']) ?? 'table';
    else if (arg === '--json') a.format = 'json';
    else if (arg === '--detail') a.detail = argv[++i];
  }
  return a;
}

function printStandings(res: LeaderboardResponse): void {
  const w = res.window;
  console.log(
    `\nBoxscore ... ${scopeLabel(res)}  ${w.start.slice(0, 10)} → ${w.end.slice(0, 10)}`
  );
  console.log(
    `${res.fromCache ? 'cached' : 'fresh'}${res.hasTrend ? ' · trend on' : ''} · ${res.users.filter(u => u.resolved).length}/${res.users.length} resolved\n`
  );

  console.log('STANDINGS BY METRIC (1 = best):');
  for (const d of METRICS) {
    const ranked = res.users
      .filter(u => u.resolved && metricValue(u.metrics, d) !== null)
      .sort(
        (a, b) =>
          (metricRank(a.metrics, d) ?? 99) - (metricRank(b.metrics, d) ?? 99)
      );
    const line = ranked
      .map(
        u =>
          `${metricRank(u.metrics, d)}.${u.name ?? u.username}(${fmt(metricValue(u.metrics, d), d)})`
      )
      .join('  ');
    console.log(`  ${d.label.padEnd(16)} ${line || '(no data)'}`);
  }

  console.log('\nLEADERS:');
  for (const d of METRICS) {
    console.log(`  ${d.label.padEnd(16)} ${res.leaders[d.key] ?? '...'}`);
  }

  if (res.warnings.length) {
    console.log('\nWARNINGS:');
    for (const wn of res.warnings)
      console.log(`  ⚠ [${wn.code}] ${wn.message.slice(0, 160)}`);
  }
}

function scopeLabel(res: LeaderboardResponse): string {
  return res.scope.type === 'group'
    ? (res.scope.groupPath ?? 'group')
    : (res.scope.projectPaths ?? []).join(', ');
}

function printValidation(res: LeaderboardResponse): number {
  const report = validateLeaderboard(res);
  console.log(
    `\nVALIDATION: ${report.ok ? 'PASS' : 'FAIL'} · ${report.errors} error(s), ${report.warnings} warning(s)`
  );
  for (const issue of report.issues) {
    const icon = issue.severity === 'error' ? '✗' : '⚠';
    console.log(`  ${icon} [${issue.code}] ${issue.message}`);
  }
  return report.ok ? 0 : 1;
}

function printDetail(res: UserDetailResponse): void {
  const w = res.window;
  console.log(
    `\nDetail · ${res.user.name ?? res.user.username} (@${res.user.username})  ${w.start.slice(0, 10)} → ${w.end.slice(0, 10)}`
  );
  console.log(
    `${res.fromCache ? 'cached' : 'fresh'}${res.hasTrend ? ' · trend on' : ''}\n`
  );

  for (const d of METRICS) {
    const ev = res.evidence[d.key as MetricKey];
    const desc = metricByKey(d.key);
    const headline = fmt(metricValue(res.user.metrics, d), d);
    const rank = metricRank(res.user.metrics, d);
    console.log(
      `── ${d.label}  =${headline}${rank ? ` (#${rank})` : ''} ${desc ? `· ${desc.group}` : ''}`
    );
    if (!ev || ev.rows.length === 0) {
      console.log(`   ${ev?.summary ?? '(no records)'}\n`);
      continue;
    }
    if (ev.summary) console.log(`   ${ev.summary}`);
    console.log(`   ${ev.columns.join(' | ')}`);
    for (const row of ev.rows.slice(0, 15)) {
      console.log(`   ${row.muted ? '· ' : '  '}${row.cells.join(' | ')}`);
    }
    if (ev.rows.length > 15) console.log(`   … ${ev.rows.length - 15} more`);
    console.log('');
  }
}

async function printBots(): Promise<void> {
  const bots = await scanSuspectedBots(readSettings().botPatterns);
  if (bots.length === 0) {
    console.log('no suspected bots anywhere in the store');
    return;
  }
  for (const b of bots)
    console.log(`${b.username}  matched: ${b.matchedPattern}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.format === 'bots') {
    await printBots();
    return;
  }

  const window = resolveWindowArgs(
    args.range,
    args.start,
    args.end,
    readSettings().defaultRange
  );

  if (args.detail) {
    const detail = await getUserDetail({
      window,
      refresh: args.refresh,
      trend: args.trend,
      user: args.detail,
    });
    if (args.format === 'json') console.log(JSON.stringify(detail, null, 2));
    else printDetail(detail);
    return;
  }

  // A plain read never fetches, so a cold store would otherwise print an empty board that
  // looks like a real result. Probe first and say what to run instead.
  if (!args.refresh) {
    try {
      await getLeaderboard({
        window,
        refresh: false,
        trend: args.trend,
        cacheOnly: true,
      });
    } catch (err) {
      if ((err as Error).name === 'ColdCacheError') {
        console.error(
          'No data stored for this window yet. Run again with --refresh to fetch it.'
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  const res = await getLeaderboard({
    window,
    refresh: args.refresh,
    trend: args.trend,
  });

  if (args.format === 'json') {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  printStandings(res);

  if (args.format === 'validate') {
    const code = printValidation(res);
    process.exit(code);
  }
}

main().catch(err => {
  console.error('cli failed:', (err as Error).message);
  process.exit(1);
});
