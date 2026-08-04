#!/usr/bin/env bun
/**
 * Live conformance runner.
 *
 * Deliberately not named `*.test.ts`: it needs real credentials and mutates
 * real projects, so `bun test tests/` must never pick it up.
 *
 * Run: bun tests/live/runner.ts
 */

import {
  runMergeConformance,
  runReadConformance,
  runUnsupportedConformance,
  runWriteConformance
} from './conformance.ts';
import { buildFixtures } from './fixture.ts';
import { Reporter } from './report.ts';

const { fixtures, missing } = await buildFixtures();

if (fixtures.length === 0 && missing.length === 0) {
  console.error('No fixtures could be built. Nothing to run.');
  process.exit(1);
}

const report = new Reporter();

for (const fixture of fixtures) {
  console.log(`\n=== ${fixture.name} (${fixture.projectPath}) ===\n`);
  await runReadConformance(fixture, report);
  await runUnsupportedConformance(fixture, report);
  await runWriteConformance(fixture, report);
  await runMergeConformance(fixture, report);
}

console.log(`\n${'='.repeat(60)}\n`);

// A provider that was expected (named in harness_credentials.json) but
// never got built must never be allowed to read as a clean run. Printing
// this ahead of the pass/fail summary, and forcing a non-zero exit below,
// is what stops a CI job (or a human skimming only the tail of the log)
// from seeing "gitlab: 9 passed, 0 failed" and concluding the whole
// harness passed when GitHub was never touched.
if (missing.length > 0) {
  console.log('!'.repeat(60));
  console.log(
    `INCOMPLETE RUN: ${missing.length} of ${missing.length + fixtures.length} ` +
      'expected provider(s) were never tested:'
  );
  for (const m of missing) {
    console.log(`  MISSING ${m.name}: ${m.reason}`);
  }
  console.log('!'.repeat(60));
  console.log('');
}

console.log(report.render());
process.exit(missing.length > 0 ? 1 : report.exitCode);
