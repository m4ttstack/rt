#!/usr/bin/env bun
/**
 * Live conformance runner.
 *
 * Deliberately not named `*.test.ts`: it needs real credentials and mutates
 * real projects, so `bun test tests/` must never pick it up.
 *
 * Run: bun tests/live/runner.ts
 */

import { runReadConformance, runUnsupportedConformance } from './conformance.ts';
import { buildFixtures } from './fixture.ts';
import { Reporter } from './report.ts';

const fixtures = await buildFixtures();
if (fixtures.length === 0) {
  console.error('No fixtures could be built. Nothing to run.');
  process.exit(1);
}

const report = new Reporter();

for (const fixture of fixtures) {
  console.log(`\n=== ${fixture.name} (${fixture.projectPath}) ===\n`);
  await runReadConformance(fixture, report);
  await runUnsupportedConformance(fixture, report);
}

console.log(`\n${'='.repeat(60)}\n`);
console.log(report.render());
process.exit(report.exitCode);
