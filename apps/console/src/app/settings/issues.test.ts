import type { SchemaIssue } from '@mattstack/settings-kit/shapes';
import { describe, expect, it } from 'vitest';

import { footerSummary, type CardKey } from './issues';

describe('footerSummary with string card keys (named sections)', () => {
  it('numbers a touched issue by entry name, not #N', () => {
    const issues: SchemaIssue[] = [
      {
        path: ['github.example.com', 'tokenEnv'],
        message: 'expected string, got number',
      },
    ];
    const touched = new Map<CardKey, ReadonlySet<string>>([
      ['github.example.com', new Set(['tokenEnv'])],
    ]);
    const summary = footerSummary(issues, touched);
    expect(summary.touchedText).toBe(
      'github.example.com tokenEnv: expected string, got number'
    );
  });

  it('falls back to the entry name for an untouched, non-required issue', () => {
    const issues: SchemaIssue[] = [
      {
        path: ['github.example.com', 'tokenEnv'],
        message: 'expected string, got number',
      },
    ];
    const summary = footerSummary(issues, new Map());
    expect(summary.fallbackText).toBe(
      'github.example.com tokenEnv: expected string, got number'
    );
    expect(summary.touchedText).toBeNull();
  });

  it('names every untouched entry with a missing required property in the note', () => {
    const issues: SchemaIssue[] = [
      {
        path: ['git.example.org', 'provider'],
        message: 'required property "provider" is missing',
      },
      {
        path: ['other.example.org', 'provider'],
        message: 'required property "provider" is missing',
      },
    ];
    const summary = footerSummary(issues, new Map());
    expect(summary.noteText).toBe(
      'git.example.org, other.example.org have 2 empty required fields'
    );
  });
});
