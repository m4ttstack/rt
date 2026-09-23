export interface MoveApi {
  set(scope: string, value: unknown): Promise<string | null>;
  unset(scope: string): Promise<string | null>;
}

/** Moves the source layer's AUTHORED value, not the effective one: for a
    deep-merged key the effective value includes defaults and other layers,
    which must not be baked into the target. */
export async function moveValue(
  api: MoveApi,
  from: string,
  to: string,
  authored: { present: boolean; value?: unknown },
): Promise<string | null> {
  if (from === to) return `already in ${to}`;
  if (!authored.present) return `${from} holds no value to move`;
  const setErr = await api.set(to, authored.value);
  if (setErr) return setErr;
  const unsetErr = await api.unset(from);
  return unsetErr ? `moved to ${to}, but ${from} still holds a value: ${unsetErr}` : null;
}
