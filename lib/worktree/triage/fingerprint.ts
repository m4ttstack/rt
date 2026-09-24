import { createHash } from "crypto";
import type { KeepRecord } from "../registry.ts";

export interface Fingerprint { headSha: string; dirtHash: string; mrState: string | null }

export function dirtHash(files: string[]): string {
  return createHash("sha256").update([...files].sort().join("\0")).digest("hex").slice(0, 16);
}

export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.headSha === b.headSha && a.dirtHash === b.dirtHash && (a.mrState ?? null) === (b.mrState ?? null);
}

export function keepStillHolds(kept: KeepRecord, now: Fingerprint): boolean {
  return sameFingerprint(kept, now);
}
