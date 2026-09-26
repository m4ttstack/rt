import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  claimLease,
  DEFAULT_ATTENDANT_TTL_SECONDS,
  heartbeatLease,
  leaseFileName,
  readLease,
  readLeaseByBranch,
  releaseLease,
  type AttendantLease,
} from '../triage/attendant.ts';

const MR = 'https://gitlab.example.com/acme/webapp/-/merge_requests/4821';
const IID = 4821;
const NOW = 1_700_000_000_000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'attendants-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lease(over: Partial<AttendantLease> = {}): AttendantLease {
  return {
    mr: MR,
    holder: 'watch-ci',
    startedAt: NOW,
    heartbeatAt: NOW,
    ttlSeconds: DEFAULT_ATTENDANT_TTL_SECONDS,
    ...over,
  };
}

describe('leaseFileName', () => {
  test('keys on project path + iid, filesystem-safe, no collisions across projects', () => {
    const a = leaseFileName(
      'https://gitlab.example.com/acme/webapp/-/merge_requests/7',
      7
    );
    const b = leaseFileName(
      'https://gitlab.example.com/acme/other-repo/-/merge_requests/7',
      7
    );
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9._-]+\.json$/);
    expect(a).toContain('7');
  });
});

describe('claim/read/release', () => {
  test('claim on empty dir succeeds and readLease returns the fresh record', () => {
    const r = claimLease(dir, lease(), NOW);
    expect(r.ok).toBe(true);
    const got = readLease(dir, MR, IID, NOW);
    expect(got?.holder).toBe('watch-ci');
  });

  test('claim creates the directory when missing', () => {
    const nested = join(dir, 'does', 'not', 'exist');
    expect(claimLease(nested, lease(), NOW).ok).toBe(true);
  });

  test('a fresh foreign lease blocks a claim and reports the holder', () => {
    expect(claimLease(dir, lease({ holder: 'watch-ci' }), NOW).ok).toBe(true);
    const r = claimLease(dir, lease({ holder: 'doctor' }), NOW + 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.holder.holder).toBe('watch-ci');
  });

  test('a stale lease is replaced by a new claim', () => {
    const ttlMs = DEFAULT_ATTENDANT_TTL_SECONDS * 1_000;
    expect(claimLease(dir, lease({ holder: 'watch-ci' }), NOW).ok).toBe(true);
    const r = claimLease(
      dir,
      lease({
        holder: 'doctor',
        startedAt: NOW + ttlMs + 1_000,
        heartbeatAt: NOW + ttlMs + 1_000,
      }),
      NOW + ttlMs + 1_000
    );
    expect(r.ok).toBe(true);
    expect(readLease(dir, MR, IID, NOW + ttlMs + 1_000)?.holder).toBe('doctor');
  });

  test('readLease returns null for missing, stale, or malformed leases', () => {
    expect(readLease(dir, MR, IID, NOW)).toBeNull();
    claimLease(dir, lease(), NOW);
    const ttlMs = DEFAULT_ATTENDANT_TTL_SECONDS * 1_000;
    expect(readLease(dir, MR, IID, NOW + ttlMs + 1)).toBeNull();
    writeFileSync(join(dir, leaseFileName(MR, IID)), 'not json');
    expect(readLease(dir, MR, IID, NOW)).toBeNull();
  });

  test("release removes only the named holder's lease", () => {
    claimLease(dir, lease({ holder: 'doctor' }), NOW);
    releaseLease(dir, MR, IID, 'watch-ci');
    expect(readLease(dir, MR, IID, NOW)?.holder).toBe('doctor');
    releaseLease(dir, MR, IID, 'doctor');
    expect(readLease(dir, MR, IID, NOW)).toBeNull();
  });

  test('release on a missing lease is a no-op', () => {
    expect(() => releaseLease(dir, MR, IID, 'doctor')).not.toThrow();
  });
});

describe('heartbeat', () => {
  test("heartbeat refreshes only the named holder's lease", () => {
    claimLease(dir, lease({ holder: 'doctor' }), NOW);
    heartbeatLease(dir, MR, IID, 'watch-ci', NOW + 5_000);
    expect(readLease(dir, MR, IID, NOW)?.heartbeatAt).toBe(NOW);
    heartbeatLease(dir, MR, IID, 'doctor', NOW + 5_000);
    expect(readLease(dir, MR, IID, NOW)?.heartbeatAt).toBe(NOW + 5_000);
  });

  test('heartbeat keeps a lease alive past its original TTL', () => {
    const ttlMs = DEFAULT_ATTENDANT_TTL_SECONDS * 1_000;
    claimLease(dir, lease({ holder: 'doctor' }), NOW);
    heartbeatLease(dir, MR, IID, 'doctor', NOW + ttlMs - 1_000);
    expect(readLease(dir, MR, IID, NOW + ttlMs + 1_000)?.holder).toBe('doctor');
  });
});

describe('readLeaseByBranch (BOARD-12)', () => {
  test('finds a fresh lease by the branch it names, whatever MR it belongs to', () => {
    writeFileSync(
      join(dir, leaseFileName(MR, IID)),
      JSON.stringify(lease({ branch: 'feat-parent' }))
    );
    expect(readLeaseByBranch(dir, 'feat-parent', NOW)?.mr).toBe(MR);
  });

  test('ignores a stale lease, a mismatched branch, and a lease with no branch at all', () => {
    writeFileSync(
      join(dir, leaseFileName(MR, IID)),
      JSON.stringify(lease({ branch: 'feat-parent' }))
    );
    expect(readLeaseByBranch(dir, 'feat-parent', NOW + 601_000)).toBeNull();
    expect(readLeaseByBranch(dir, 'other-branch', NOW)).toBeNull();
    writeFileSync(
      join(dir, leaseFileName(MR, 999)),
      JSON.stringify(lease({ branch: undefined }))
    );
    expect(readLeaseByBranch(dir, '', NOW)).toBeNull();
  });

  test('a missing directory or unparseable file is null, never a throw', () => {
    expect(readLeaseByBranch(join(dir, 'nope'), 'feat-parent', NOW)).toBeNull();
    writeFileSync(join(dir, 'garbage.json'), '{not json');
    expect(readLeaseByBranch(dir, 'feat-parent', NOW)).toBeNull();
  });
});
