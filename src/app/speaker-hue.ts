import { HUMAN_HANDLE } from './human';

/** Every non-human speaker's rotation, purple/cyan (`--tk-*`) plus the
    ok/warn/bad virtual-color text ramps -- accent is withheld here since
    the human owns it outright below. Ordered so adjacent hash values (the
    modulo wraps) land on visibly distinct hues. */
export const HUES = [
  'var(--tk-purple)',
  'var(--tk-cyan)',
  'var(--mantine-color-ok-text)',
  'var(--mantine-color-warn-text)',
  'var(--mantine-color-bad-text)',
];

export const ACCENT = 'var(--mantine-color-accent-text)';

/** The same rotation, accent included, for anything that wants the whole
    set rather than one handle's pick -- the avatar sprite hashes `handle`
    against this independently of `speakerHue`, so its color and the name
    chip's color are drawn from the same tokens without being forced equal. */
export const HANDLE_PALETTE = [ACCENT, ...HUES];

/** A 31-multiplier char-code fold, the same shape as Java's `String.hashCode`. */
function foldHash(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Contract: the same handle always resolves to the same hue, forever --
 * callers memo nothing and re-derive it on every render. The human's handle
 * short-circuits to accent, matching the tint his own posts already carry;
 * accent never appears in the rotation, so no other speaker can land on it.
 * `humanHandle` defaults to `HUMAN_HANDLE`, but the transcript passes its own
 * `humanHandle` prop so the accent chip and the accent wash agree on who the
 * human is.
 */
export function speakerHue(
  handle: string,
  humanHandle: string = HUMAN_HANDLE
): string {
  if (handle === humanHandle) return ACCENT;
  const index = ((foldHash(handle) % HUES.length) + HUES.length) % HUES.length;
  return HUES[index]!;
}
