import {
  optionDescription,
  optionDisplayFor,
  optionValue,
  type GateOption,
} from '@mattstack/gate-kit';

export interface ParsedFinding {
  id: string;
  tier: string;
  title: string;
  /** A real diff anchor (`path/to/file.ts:42`), safe to render as code. */
  anchor?: string;
  /** The engine's `fileLabel` for a finding that anchors to nothing in the
      diff -- prose, not a path, so it must never be styled as one. */
  anchorLabel?: string;
  fix?: string;
  kind?: string;
}

const LABEL_RE = /^\[([A-Za-z]+)\]\s+(.+)$/;
const ANCHORISH_RE = /\/|\.[a-z]+:\d+$|^[A-Z_]{3,}$|^[\w.-]+\.[a-z0-9]{1,8}$/;
const KIND_RE = /\s·\skind:([a-z-]+)$/;

export function parseFindingOption(option: GateOption): ParsedFinding | null {
  const label = optionDisplayFor(option).text;
  const m = LABEL_RE.exec(label);
  if (!m) return null;
  const parsed: ParsedFinding = {
    id: optionValue(option),
    tier: m[1]!,
    title: m[2]!,
  };
  let description = optionDescription(option);
  if (description !== undefined) {
    const k = KIND_RE.exec(description);
    if (k) {
      parsed.kind = k[1]!;
      description = description.slice(0, -k[0].length);
    }
  }
  if (description !== undefined) {
    const at = description.indexOf(' · ');
    if (at >= 0) {
      // The lead segment is only an anchor if it looks like one. The engine
      // puts its `fileLabel` here for findings that anchor to nothing in the
      // diff, and that text is prose -- rendering it as a path claims a
      // source location the finding does not have.
      const lead = description.slice(0, at);
      if (ANCHORISH_RE.test(lead)) parsed.anchor = lead;
      else parsed.anchorLabel = lead;
      parsed.fix = description.slice(at + 3);
    } else if (ANCHORISH_RE.test(description)) {
      parsed.anchor = description;
    } else {
      parsed.fix = description;
    }
  }
  return parsed;
}
