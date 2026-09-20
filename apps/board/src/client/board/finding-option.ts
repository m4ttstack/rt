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
  anchor?: string;
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
      parsed.anchor = description.slice(0, at);
      parsed.fix = description.slice(at + 3);
    } else if (ANCHORISH_RE.test(description)) {
      parsed.anchor = description;
    } else {
      parsed.fix = description;
    }
  }
  return parsed;
}
