import type { ExplainRowWire, SettingDefWire } from '../../server/settings';

export type ChainVerdict =
  | {
      kind: 'scalar';
      winner: ExplainRowWire | null;
      overridden: ExplainRowWire[];
      sentence: string;
    }
  | { kind: 'composite'; contributors: ExplainRowWire[]; sentence: string };

const MAX_VALUE_CHARS = 40;

export function shortValue(v: unknown): string {
  const text = JSON.stringify(v) ?? 'undefined';
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}…`
    : text;
}

/** A row that actually participates in resolution: authored, not shadowed
    by teamLocked, not refused by the validator. */
function effective(rows: ExplainRowWire[]): ExplainRowWire[] {
  return rows.filter(r => r.present && !r.shadowed && !r.invalid);
}

/**
 * Rows arrive WEAKEST-FIRST (explainSetting's contract), so "last effective
 * row" is the winner. Only a deep-merged object key has contributors instead
 * of a winner; arrays replace atomically — the merge treats an array as a
 * leaf — so an array key gets winner semantics like any scalar.
 */
export function analyzeChain(
  def: SettingDefWire,
  rows: ExplainRowWire[]
): ChainVerdict {
  const active = effective(rows);

  if (def.merge === 'deep' && def.type === 'object') {
    const n = active.length;
    return {
      kind: 'composite',
      contributors: active,
      sentence: `${def.key} deep-merges key by key — ${n} layer${n === 1 ? '' : 's'} contribute${n === 1 ? 's' : ''}; there is no single winner.`,
    };
  }

  const winner = active.at(-1) ?? null;
  const overridden = active.slice(0, -1);

  if (!winner) {
    return {
      kind: 'scalar',
      winner: null,
      overridden: [],
      sentence: def.hasDefault
        ? `${def.key} is unset in every layer — the registry default ${shortValue(def.defaultValue)} applies.`
        : `${def.key} is unset — no layer sets it and the registry declares no default.`,
    };
  }

  const value = shortValue(winner.value);
  const sentence =
    winner.scope === 'default'
      ? `${def.key} is ${value} — the registry default; nothing overrides it.`
      : `${def.key} is ${value} because the ${winner.scope} layer sets it${
          overridden.length > 0
            ? `, overriding ${overridden.map(r => r.scope).join(', ')}`
            : ''
        }.`;

  return { kind: 'scalar', winner, overridden, sentence };
}
