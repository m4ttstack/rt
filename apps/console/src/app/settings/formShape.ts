import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  rowKind,
  type JsonSchema,
  type LeafType,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

export interface FieldSpec {
  type: LeafType;
  title?: string;
  description?: string;
  placeholder?: string;
  default?: unknown;
  suggestions?: string[];
}

/** A list or map of objects drawn as cards or sections. `nested` names
    declared properties that are not scalars: drawn read-only, kept on
    save. */
export interface FormShape {
  kind: 'objectList' | 'objectMap';
  fields: Record<string, FieldSpec>;
  nested: string[];
  required: string[];
  labels: [string, string];
}

type Entry = Record<string, unknown>;

function isRecord(v: unknown): v is Entry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function leafOf(s: JsonSchema): LeafType | null {
  if (typeof s.const === 'string') return { enum: [s.const] };
  if (Array.isArray(s.enum) && s.enum.every(e => typeof e === 'string'))
    return { enum: s.enum as string[] };
  if (s.type === 'string' || s.type === 'number' || s.type === 'boolean')
    return s.type;
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter(x => x !== 'null');
    if (t.length === 1) return leafOf({ ...s, type: t[0] });
  }
  return null;
}

function fieldOf(s: JsonSchema): FieldSpec | null {
  const type = leafOf(s);
  if (!type) return null;
  const f: FieldSpec = { type };
  if (typeof s.title === 'string') f.title = s.title;
  if (typeof s.description === 'string') f.description = s.description;
  if (typeof s.placeholder === 'string') f.placeholder = s.placeholder;
  if (s.default !== undefined) f.default = s.default;
  if (Array.isArray(s.examples) && s.examples.every(e => typeof e === 'string'))
    f.suggestions = s.examples as string[];
  return f;
}

/** Cards for a list of objects, sections for a map of objects, when every
    required property is a scalar and at least one property is. Anything
    else is JSON only. */
export function formShape(schema: JsonSchema | undefined): FormShape | null {
  if (!schema) return null;
  let item: JsonSchema | undefined;
  let kind: FormShape['kind'];
  if (schema.type === 'array') {
    item = schema.items as JsonSchema | undefined;
    kind = 'objectList';
  } else if (schema.type === 'object') {
    const props = schema.properties as Record<string, unknown> | undefined;
    const add = schema.additionalProperties;
    if (props && Object.keys(props).length > 0) return null;
    if (!isRecord(add) || Object.keys(add).length === 0) return null;
    item = add as JsonSchema;
    kind = 'objectMap';
  } else return null;
  if (!item || item.type !== 'object' || !isRecord(item.properties))
    return null;
  const fields: Record<string, FieldSpec> = {};
  const nested: string[] = [];
  for (const [name, prop] of Object.entries(
    item.properties as Record<string, JsonSchema>
  )) {
    const f = fieldOf(prop);
    if (f) fields[name] = f;
    else nested.push(name);
  }
  const required = Array.isArray(item.required)
    ? (item.required as string[])
    : [];
  if (Object.keys(fields).length === 0) return null;
  if (required.some(r => !(r in fields))) return null;
  const labels = schema.labels as { key?: string; value?: string } | undefined;
  return {
    kind,
    fields,
    nested,
    required,
    labels: [labels?.key ?? 'name', labels?.value ?? 'value'],
  };
}

export function formOf(def: SettingDefWire): FormShape | null {
  return formShape(def.layerSchema ?? def.schema);
}

/** The editor a composite row gets: a form when `formOf` can draw it,
    JSON for any other list or object. */
export function editorKind(def: SettingDefWire): RowKind {
  const kind = rowKind(def);
  if (kind !== 'objectList' && kind !== 'objectMap' && kind !== 'json')
    return kind;
  return formOf(def)?.kind ?? 'json';
}

export function canDraw(shape: FormShape, value: unknown): boolean {
  if (shape.kind === 'objectList')
    return Array.isArray(value) && value.every(isRecord);
  return isRecord(value) && Object.values(value).every(isRecord);
}

/** Required scalars from their schema defaults; a required switch with no
    default starts off, since a switch has no empty state. */
export function newEntry(shape: FormShape): Entry {
  const out: Entry = {};
  for (const name of shape.required) {
    const f = shape.fields[name]!;
    if (f.default !== undefined) out[name] = f.default;
    else if (f.type === 'boolean') out[name] = false;
  }
  return out;
}

export function visibleFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return Object.keys(shape.fields).filter(
    k =>
      shape.required.includes(k) || entry[k] !== undefined || shown.includes(k)
  );
}

export function addableFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return Object.keys(shape.fields).filter(
    k =>
      !shape.required.includes(k) &&
      entry[k] === undefined &&
      !shown.includes(k)
  );
}

export function extraKeys(shape: FormShape, entry: Entry): string[] {
  return Object.keys(entry).filter(k => !(k in shape.fields));
}
