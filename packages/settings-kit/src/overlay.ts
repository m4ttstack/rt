function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Field-by-field overlay; arrays and scalars replace, matching rt's deep merge. */
export function overlay(base: unknown, top: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(top)) return top;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(top)) out[k] = overlay(base[k], v);
  return out;
}
