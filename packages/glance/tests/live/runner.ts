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
  runCiConformance,
  runMergeConformance,
  runReadConformance,
  runUnsupportedConformance,
  runWriteConformance
} from './conformance.ts';
import { runConsumerFlows } from './consumerFlows.ts';
import { ALL_METHODS } from './expectations.ts';
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
  try {
    await runReadConformance(fixture, report);
    await runUnsupportedConformance(fixture, report);
    await runWriteConformance(fixture, report);
    await runMergeConformance(fixture, report);
    await runCiConformance(fixture, report);
    // After the conformance suite, deliberately: the consumer flows open
    // their own pull requests, and runCiConformance selects a settled
    // pipeline by scanning the most recent ones. Running the flows first
    // would push fresh, still-running pipelines in front of that scan.
    await runConsumerFlows(fixture, report);
  } catch (err) {
    // Every mutating step above is wrapped in check(), so reaching here
    // means something outside those wrappers threw (e.g. a network blip
    // between calls). Without this catch, one fixture crashing would throw
    // out of the whole loop and erase results already gathered for a
    // fixture that ran earlier, which is worse than losing this fixture's
    // remaining checks.
    const message = err instanceof Error ? err.message : String(err);
    report.fail(fixture.name, 'runFixture', 'fixture run completed without crashing', message);
    console.error(`  CRASH ${fixture.name}: ${message}`);
  }
}

// Every ProviderMethod must appear at least once in the report for a
// provider that ran, or its absence reads as "nobody wrote a check for
// this" rather than "an early return dropped it this run" -- the second is
// what actually happened at three call sites in conformance.ts. Checked
// once per fixture, after the loop above finishes, so a crash partway
// through one fixture doesn't stop this from still naming everything else
// that came up short.
for (const fixture of fixtures) {
  report.assertFullCoverage(fixture.name, ALL_METHODS);
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
