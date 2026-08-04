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
