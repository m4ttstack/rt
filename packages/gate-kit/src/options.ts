import type { GateOption } from '@mattstack/rt-client';

export interface GateOptionDisplay {
  /** What to render. */
  text: string;
  /** The full option string, when it differs from `text` -- callers put this
      in a `title` attr so the truncated form stays inspectable. */
  title?: string;
}

/** A `<verb>:<token>` option whose token is long enough to be a real id
    (thread hash, gate id, ...) rather than a short human word like
    "addressed". Only these get compacted -- see formatGateOption. */
const VERB_TOKEN_OPTION = /^([a-z][a-z-]*):(.{12,})$/;

export function optionValue(o: GateOption): string {
  return typeof o === 'string' ? o : o.value;
}

export function optionLabel(o: GateOption): string {
  return typeof o === 'string' ? o : o.label || o.value;
}

/**
 * Display-only transform for one gate option string. This NEVER changes what
 * gets submitted -- renderers show `text` but keep passing the original
 * option/value string to onChange/gateAnswerPayload, so a `reply:<id>` option
 * answers with the id verbatim no matter how it displays.
 *
 * A `verb:longtoken` option (e.g. `fix:7080da2fcf93c1a2`, a thread id the
 * respond gate can't shorten without breaking the reply/fix/skip join back to
 * the report) renders as the verb plus the token's first 8 characters, with
 * the full string carried in `title`. Everything else -- a bare word like
 * "approve"/"comment", or a `verb:value` pair whose value reads as a short
 * human word rather than an id -- renders unchanged.
 */
export function formatGateOption(option: string): GateOptionDisplay {
  const m = VERB_TOKEN_OPTION.exec(option);
  if (!m) return { text: option };
  const [, verb, token] = m;
  return { text: `${verb} · ${token!.slice(0, 8)}`, title: option };
}

/** Labeled options render their label with the raw value as the hover
    title; bare strings keep the verb-token transform unchanged. */
export function optionDisplayFor(o: GateOption): GateOptionDisplay {
  if (typeof o !== 'string') {
    const text = o.label || o.value;
    return text === o.value ? { text } : { text, title: o.value };
  }
  return formatGateOption(o);
}

export function displayForValue(
  value: string,
  options: GateOption[]
): GateOptionDisplay {
  const match = options.find(o => optionValue(o) === value);
  return match !== undefined
    ? optionDisplayFor(match)
    : formatGateOption(value);
}
