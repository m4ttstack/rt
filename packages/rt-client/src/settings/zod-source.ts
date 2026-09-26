/**
 * Rebuilds zod v4 source from a lock's JSON Schema, so a drafted migration
 * can carry its source version's schema. Covers spec 1's keyword set;
 * anything else is appended as a marked comment for review, and the CI
 * acceptance rule stays red until the rebuilt schema matches the lock.
 * Authoring only.
 */

import { isSchema, type JsonSchema } from "./schema.ts";

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "default", "examples", "labels", "placeholder", "deprecated", "readOnly", "writeOnly"]);
const HANDLED = new Set([
  "type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "enum", "const", "anyOf", "oneOf",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern",
]);

const bound = (method: string, v: unknown) => (typeof v === "number" ? `.${method}(${v})` : "");
const propKey = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

export function zodSource(s: JsonSchema): string {
  const extra = Object.keys(s).filter((k) => !HANDLED.has(k) && !ANNOTATIONS.has(k));
  return `${build(s)}${extra.length > 0 ? ` /* not rebuilt: ${extra.join(", ")} */` : ""}`;
}

function build(s: JsonSchema): string {
  if ("const" in s) return `z.literal(${JSON.stringify(s.const)})`;
  if (Array.isArray(s.enum)) {
    return s.enum.every((v) => typeof v === "string")
      ? `z.enum(${JSON.stringify(s.enum)})`
      : `z.union([${s.enum.map((v) => `z.literal(${JSON.stringify(v)})`).join(", ")}])`;
  }
  if (Array.isArray(s.anyOf)) return `z.union([${(s.anyOf as JsonSchema[]).map(zodSource).join(", ")}])`;
  if (Array.isArray(s.oneOf)) return `z.union([${(s.oneOf as JsonSchema[]).map(zodSource).join(", ")}]) /* oneOf in the lock */`;
  if (Array.isArray(s.type)) return `z.union([${(s.type as string[]).map((t) => build({ ...s, type: t })).join(", ")}])`;
  switch (s.type) {
    case "string":
      return `z.string()${bound("min", s.minLength)}${bound("max", s.maxLength)}${typeof s.pattern === "string" ? `.regex(new RegExp(${JSON.stringify(s.pattern)}))` : ""}`;
    case "number":
      return `z.number()${numberBounds(s)}`;
    case "integer":
      return `z.number().int()${numberBounds(s)}`;
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      return arraySource(s);
    case "object":
      return objectSource(s);
    default:
      return "z.unknown()";
  }
}

function numberBounds(s: JsonSchema): string {
  return `${bound("min", s.minimum)}${bound("max", s.maximum)}${bound("gt", s.exclusiveMinimum)}${bound("lt", s.exclusiveMaximum)}`;
}

function arraySource(s: JsonSchema): string {
  if (Array.isArray(s.prefixItems)) {
    const rest = isSchema(s.items) ? `, ${zodSource(s.items)}` : "";
    return `z.tuple([${(s.prefixItems as JsonSchema[]).map(zodSource).join(", ")}]${rest})`;
  }
  const item = isSchema(s.items) ? zodSource(s.items) : "z.unknown()";
  return `z.array(${item})${bound("min", s.minItems)}${bound("max", s.maxItems)}`;
}

function objectSource(s: JsonSchema): string {
  const props = (isSchema(s.properties) ? s.properties : {}) as Record<string, JsonSchema>;
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const extras = s.additionalProperties;
  const valueSchema = isSchema(extras) && Object.keys(extras).length > 0;
  if (Object.keys(props).length === 0 && (s.propertyNames !== undefined || valueSchema)) {
    const keys = isSchema(s.propertyNames) ? zodSource(s.propertyNames) : "z.string()";
    return `z.record(${keys}, ${isSchema(extras) ? zodSource(extras) : "z.unknown()"})`;
  }
  const shape = Object.entries(props).map(([name, p]) => `${propKey(name)}: ${zodSource(p)}${required.has(name) ? "" : ".optional()"}`);
  const body = `{ ${shape.join(", ")} }`;
  if (extras === false) return `z.strictObject(${body})`;
  if (extras === true || (isSchema(extras) && !valueSchema)) return `z.looseObject(${body})`;
  if (valueSchema) return `z.object(${body}).catchall(${zodSource(extras as JsonSchema)})`;
  return `z.object(${body})`;
}
