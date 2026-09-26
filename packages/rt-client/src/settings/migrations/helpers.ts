/**
 * Building blocks for migration steps, drafted or hand-written. A path
 * segment "[]" walks every array item and "{}" every record value. A node
 * that is missing or not an object is returned unchanged, so a partial
 * deep-merge layer stays partial. Inputs are never mutated.
 */

export type MigrationPath = string[];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapAt(value: unknown, path: MigrationPath, fn: (obj: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (path.length === 0) return isObject(value) ? fn(value) : value;
  const [head, ...rest] = path as [string, ...string[]];
  if (head === "[]") return Array.isArray(value) ? value.map((item) => mapAt(item, rest, fn)) : value;
  if (!isObject(value)) return value;
  if (head === "{}") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapAt(v, rest, fn)]));
  return Object.hasOwn(value, head) ? { ...value, [head]: mapAt(value[head], rest, fn) } : value;
}

export function renameProperty(value: unknown, path: MigrationPath, from: string, to: string): unknown {
  return mapAt(value, path, (obj) => {
    if (!Object.hasOwn(obj, from)) return obj;
    const { [from]: moved, ...rest } = obj;
    return { ...rest, [to]: moved };
  });
}

export function deleteProperty(value: unknown, path: MigrationPath, name: string): unknown {
  return mapAt(value, path, (obj) => {
    if (!Object.hasOwn(obj, name)) return obj;
    const { [name]: _dropped, ...rest } = obj;
    return rest;
  });
}

export function setDefault(value: unknown, path: MigrationPath, name: string, fallback: unknown): unknown {
  return mapAt(value, path, (obj) => (Object.hasOwn(obj, name) ? obj : { ...obj, [name]: structuredClone(fallback) }));
}
