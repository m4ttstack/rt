import type { ProviderMethod } from './expectations.ts';

export interface Result {
  provider: string;
  method: string;
  label: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
}

export class Reporter {
  private readonly results: Result[] = [];

  pass(provider: string, method: string, label: string): void {
    this.results.push({ provider, method, label, ok: true });
    console.log(`  ok    ${provider} ${method}: ${label}`);
  }

  fail(provider: string, method: string, label: string, detail: string): void {
    this.results.push({ provider, method, label, ok: false, detail });
    console.error(`  FAIL  ${provider} ${method}: ${label}\n        ${detail}`);
  }

  skip(provider: string, method: string, label: string, reason: string): void {
    this.results.push({ provider, method, label, ok: true, skipped: true, detail: reason });
    console.log(`  skip  ${provider} ${method}: ${label} (${reason})`);
  }

  /**
   * Every `ProviderMethod` must show up as at least one pass, fail, or skip
   * for a provider that actually ran, or its absence from the report is
   * indistinguishable from a method nobody wrote a check for. An early
   * return upstream of a `check()` call (three of them existed in
   * conformance.ts before this method was added) drops assertions from the
   * report with no trace they were ever meant to run; this closes that
   * whole bug class at the source instead of guarding each return site.
   */
  assertFullCoverage(provider: string, methods: readonly ProviderMethod[]): void {
    const covered = new Set(
      this.results.filter(r => r.provider === provider).map(r => r.method)
    );
    for (const method of methods) {
      if (covered.has(method)) continue;
      this.fail(
        provider,
        method,
        'coverage: appears at least once in the report',
        'no pass, fail, or skip was ever recorded for this method on this provider; an early return likely dropped it'
      );
    }
  }

  get exitCode(): number {
    return this.results.some(r => !r.ok) ? 1 : 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const provider of [...new Set(this.results.map(r => r.provider))]) {
      const mine = this.results.filter(r => r.provider === provider);
      const failed = mine.filter(r => !r.ok);
      const skipped = mine.filter(r => r.skipped);
      lines.push(
        `${provider}: ${mine.length - failed.length - skipped.length} passed, ` +
          `${failed.length} failed, ${skipped.length} skipped`
      );
      for (const f of failed) {
        lines.push(`  FAIL ${f.method}: ${f.label}`);
        if (f.detail) lines.push(`       ${f.detail}`);
      }
    }
    return lines.join('\n');
  }
}
