import { HUMAN_HANDLE } from './human';

/** Every non-human speaker's rotation, purple/cyan (`--tk-*`) plus the
    ok/warn/bad virtual-color text ramps -- accent is withheld here since
    the human owns it outright below. Ordered so adjacent hash values (the
    modulo wraps) land on visibly distinct hues. Index N names the same hue
    in every array below; only which text array gets read depends on the
    caller's render size -- `HUES_FILL` never changes with band, since only
    text tokens (not fill tokens) split by size. */
const HUES_SMALL = [
  'var(--tk-text-purple-small)',
  'var(--tk-text-cyan-small)',
  'var(--mantine-color-ok-text)',
  'var(--mantine-color-warn-text)',
  'var(--mantine-color-bad-text)',
];
const HUES_BODY = [
  'var(--tk-text-purple)',
  'var(--tk-text-cyan)',
  'var(--mantine-color-ok-text)',
  'var(--mantine-color-warn-text)',
  'var(--mantine-color-bad-text)',
];
const HUES_FILL = [
  'var(--tk-fill-purple)',
  'var(--tk-fill-cyan)',
  'var(--tk-fill-ok)',
  'var(--tk-fill-warn)',
  'var(--tk-fill-bad)',
];

export const ACCENT = 'var(--mantine-color-accent-text)';
const ACCENT_FILL = 'var(--tk-fill-accent)';

/** The same rotation, accent included, for anything that wants the whole
    set rather than one handle's pick -- the avatar sprite hashes `handle`
    against this independently of `speakerHue`, so its color and the name
    chip's color are drawn from the same tokens without being forced equal.
    The avatar sprite has no font-size context to band against, so this
    reads the small-band text array; any of the three would serve. */
export const HANDLE_PALETTE = [ACCENT, ...HUES_SMALL];

/** A 31-multiplier char-code fold, the same shape as Java's `String.hashCode`. */
function foldHash(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return hash;
}

export type SpeakerHueBand = 'small' | 'body';

export interface SpeakerHue {
  /** Feeds `.hueChip`'s `color` -- the label text itself. */
  text: string;
  /** Feeds `.hueChip`'s `background-color` wash. Never band-suffixed: a
      wash takes a fill token regardless of the text's own band. */
  fill: string;
}

/**
 * Contract: the same handle always resolves to the same hue identity,
 * forever -- callers memo nothing and re-derive it on every render. The
 * human's handle short-circuits to accent, matching the tint his own posts
 * already carry; accent never appears in the rotation, so no other speaker
 * can land on it. `humanHandle` defaults to `HUMAN_HANDLE`, but the
 * transcript passes its own `humanHandle` prop so the accent chip and the
 * accent wash agree on who the human is.
 *
 * `band` picks which text shade renders: `'small'` (default) for the inbox
 * card's 14px handle, `'body'` for the message header's 16px one. A smaller
 * handle needs the higher-contrast step of its hue to stay legible, which is
 * the whole reason for the split. The same handle lands on the same hue's
 * index in either
 * band -- only the text shade at that index differs; the returned `fill`
 * never depends on `band` at all.
 */
export function speakerHue(
  handle: string,
  humanHandle: string = HUMAN_HANDLE,
  band: SpeakerHueBand = 'small'
): SpeakerHue {
  if (handle === humanHandle) return { text: ACCENT, fill: ACCENT_FILL };
  const hues = band === 'body' ? HUES_BODY : HUES_SMALL;
  const index = ((foldHash(handle) % hues.length) + hues.length) % hues.length;
  return { text: hues[index]!, fill: HUES_FILL[index]! };
}
