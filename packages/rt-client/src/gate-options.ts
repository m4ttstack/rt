import type { GateOption, GateQuestion } from "./commands.ts";

/** The canonical stored/emitted option shape (contract C11). GateOption
    (the input union) is unchanged; rows normalized by the daemon always
    satisfy this. */
export interface GateOptionObject {
  value: string;
  label: string;
  /** Per-option explanation, carried verbatim: never capitalized, never
      suffixed, never filled in from value/label. */
  description?: string;
}

export function gateOptionValue(o: GateOption): string {
  return typeof o === "string" ? o : o.value;
}
export function gateOptionLabel(o: GateOption): string {
  return typeof o === "string" ? o : (o.label || o.value);
}

/** Suffix gate-kit's stripRecommended (mattstack-apps repo,
    packages/gate-kit/src/options.ts) parses off a label to render its own
    "recommended" badge. This is the
    wire representation of `recommended: true` -- the flag itself never
    reaches the normalized output. */
const RECOMMENDED_SUFFIX = " (Recommended)";
const HAS_RECOMMENDED_SUFFIX = /\(\s*recommended\s*\)\s*$/i;

/** A label is word-like -- eligible for auto-capitalization -- only when it
    starts with a lowercase ASCII letter, has no digit/`/`/`:`/`\`/`@`
    anywhere (those mark paths, ids, and verb:token pairs that must not be
    reworded), and has no uppercase letter already (mixed-case labels like
    "gitLab" are left as the caller spelled them). */
function isWordLikeLabel(label: string): boolean {
  return /^[a-z][^A-Z0-9/:\\@]*$/.test(label);
}

function capitalize(label: string): string {
  return isWordLikeLabel(label) ? label[0]!.toUpperCase() + label.slice(1) : label;
}

/** Bare string s becomes {value: s, label: s}; a well-formed {value,label}
    object passes through untouched. Total over whatever actually arrives
    on the wire, not just the declared GateOption union: a partial object
    fills the missing field from the one present, and anything else
    (null, a number, an object with neither field) is coerced via String()
    into both fields. The resulting label is then capitalized when
    word-like (see isWordLikeLabel), and an object form's `recommended:
    true` lifts into a " (Recommended)" label suffix -- guarded against
    double-appending -- since `recommended` itself does not survive into
    the returned object; the suffix IS its wire representation. An object
    form's non-empty string `description` rides along untouched (no
    capitalization, no suffix); any other description shape is dropped.
    Every returned entry is a full {value,label} pair -- callers may trust
    the return type without re-checking it. Pure and order-preserving. */
export function normalizeGateOptions(options: GateOption[]): GateOptionObject[] {
  return options.map((o) => {
    const recommended = o !== null && typeof o === "object" && (o as { recommended?: unknown }).recommended === true;
    let value: string;
    let label: string;
    if (typeof o === "string") {
      value = o;
      label = o;
    } else if (o !== null && typeof o === "object") {
      const v = typeof (o as { value?: unknown }).value === "string" ? (o as { value: string }).value : undefined;
      const l = typeof (o as { label?: unknown }).label === "string" ? (o as { label: string }).label : undefined;
      value = v ?? l ?? String(o);
      label = l ?? v ?? String(o);
    } else {
      value = String(o);
      label = String(o);
    }
    label = capitalize(label);
    // An empty label stays empty rather than becoming just the suffix: a
    // downstream `label || value` fallback (gate-kit) must still see label
    // as absent, not as a non-empty "(Recommended)" that hides the value.
    if (recommended && label && !HAS_RECOMMENDED_SUFFIX.test(label)) label += RECOMMENDED_SUFFIX;
    const d = o !== null && typeof o === "object" ? (o as { description?: unknown }).description : undefined;
    return typeof d === "string" && d ? { value, label, description: d } : { value, label };
  });
}

export function normalizeGateQuestions(questions: GateQuestion[]): GateQuestion[] {
  return questions.map((q) => ({ ...q, options: normalizeGateOptions(q.options) }));
}
