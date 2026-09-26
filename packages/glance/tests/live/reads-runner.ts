#!/usr/bin/env bun
/**
 * Read-only live conformance: the read suite plus the metric-grade reads,
 * with none of the mutating cycles. Deliberately not named `*.test.ts`: it
 * needs real credentials, so `bun test tests/` must never pick it up.
 *
 * Run: bun tests/live/reads-runner.ts
 */

import { runMetricsReadConformance, runReadConformance } from './conformance.ts';
import { buildFixtures } from './fixture.ts';
import { Reporter } from './report.ts';

const { fixtures, missing } = await buildFixtures();
for (const m of missing) console.error(`Skipping ${m.name}: ${m.reason}`);
if (fixtures.length === 0) {
  console.error('No fixtures could be built. Nothing to run.');
  process.exit(1);
}

const report = new Reporter();
for (const fixture of fixtures) {
  console.log(`\n=== ${fixture.name} (${fixture.projectPath}) ===\n`);
  await runReadConformance(fixture, report);
  await runMetricsReadConformance(fixture, report);
}

console.log(`\n${report.render()}`);
process.exit(report.exitCode);
