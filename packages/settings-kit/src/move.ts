import { overlay } from "./overlay.ts";

export interface MoveApi {
  set(scope: string, value: unknown): Promise<string | null>;
  unset(scope: string): Promise<string | null>;
}

export interface MoveTarget {
  present: boolean;
  value?: unknown;
  outranksSource: boolean;
}

/** The target layer's own authored value and whether it outranks the
    source, from explain rows (weakest first). An invalid row counts as empty. */
export function moveTargetFrom(
  rows: ReadonlyArray<{ scope: string; present: boolean; value?: unknown; invalid?: string }>,
  from: string,
  to: string,
): MoveTarget {
  const target = rows.find((r) => r.scope === to);
  return {
    present: target?.present === true && !target.invalid && "value" in target,
    value: target?.value,
    outranksSource: rows.findIndex((r) => r.scope === to) > rows.findIndex((r) => r.scope === from),
  };
}

/** Moves the source layer's AUTHORED value, not the effective one: for a
    deep-merged key the effective value includes defaults and other layers,
    which must not be baked into the target. A deep move merges into the
    target's own authored value in precedence order, so the effective value
    is unchanged by the move. */
export async function moveValue(
  api: MoveApi,
  from: string,
  to: string,
  authored: { present: boolean; value?: unknown },
  opts: { deep?: boolean; target?: MoveTarget } = {},
): Promise<string | null> {
  if (from === to) return `already in ${to}`;
  if (!authored.present) return `${from} holds no value to move`;
  const target = opts.target;
  let value = authored.value;
  if (opts.deep && target?.present) {
    value = target.outranksSource ? overlay(value, target.value) : overlay(target.value, value);
  }
  const setErr = await api.set(to, value);
  if (setErr) return setErr;
  const unsetErr = await api.unset(from);
  return unsetErr ? `moved to ${to}, but ${from} still holds a value: ${unsetErr}` : null;
}
