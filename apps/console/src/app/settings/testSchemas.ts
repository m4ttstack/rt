import type { SettingDefWire } from '@mattstack/settings-kit/react';

type JsonSchema = NonNullable<SettingDefWire['schema']>;

const D = 'https://json-schema.org/draft/2020-12/schema';
const STRING_LIST = { $schema: D, type: 'array', items: { type: 'string' } };

/** Literal copies of the registry's JSON Schemas for the keys console tests
    render. testSchemas.test.ts fails when one drifts from rt-client's. */
export const TEST_SCHEMAS: Record<string, JsonSchema> = {
  'board.ticketPrefixes': STRING_LIST,
  'boxscore.excludeFilePatterns': STRING_LIST,
  'rt.repoRoots': STRING_LIST,
  'rt.homeSnapshot': {
    $schema: D,
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      debounceSec: { type: 'number' },
      pushDelaySec: { type: 'number' },
      janitorThresholdHours: { type: 'number' },
      janitorIntervalMin: { type: 'number' },
    },
    required: [
      'enabled',
      'debounceSec',
      'pushDelaySec',
      'janitorThresholdHours',
      'janitorIntervalMin',
    ],
    additionalProperties: {},
  },
  'rt.runaway': {
    $schema: D,
    type: 'object',
    properties: {
      cpuThreshold: { type: 'number' },
      sustainMs: { type: 'number' },
      graceMs: { type: 'number' },
    },
    additionalProperties: {},
  },
  'rt.repoIdentityOverrides': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: { type: 'string' },
    labels: { key: 'remote URL', value: 'identity' },
  },
  'rt.cron': {
    $schema: D,
    type: 'object',
    properties: {
      triggers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            event: { type: 'string', minLength: 1 },
            run: { minItems: 1, type: 'array', items: { type: 'string' } },
            repoName: { type: 'string' },
            debounceMs: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['name', 'event', 'run'],
          additionalProperties: {},
        },
      },
    },
    additionalProperties: {},
  },
  'rt.roles': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        pool: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'number' },
              {
                type: 'object',
                properties: {
                  from: { type: 'number' },
                  to: { type: 'number' },
                },
                required: ['from', 'to'],
                additionalProperties: {},
              },
            ],
          },
        },
        fixedPort: { type: 'number' },
        needs: { type: 'array', items: { type: 'string' } },
        preserveEnv: { type: 'array', items: { type: 'string' } },
        env: {
          type: 'object',
          propertyNames: { type: 'string' },
          additionalProperties: { type: 'string' },
        },
        hook: { type: 'string' },
      },
      additionalProperties: {},
    },
  },
  'rt.intercepts': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 },
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cwdGlob: { type: 'string' },
              role: { type: 'string' },
              argPattern: { type: 'string' },
              argInject: {
                type: 'object',
                properties: {
                  afterArg: { type: 'string' },
                  template: { type: 'string' },
                  skipIfArgPresent: { type: 'string' },
                },
                required: ['afterArg', 'template', 'skipIfArgPresent'],
                additionalProperties: {},
              },
            },
            required: ['cwdGlob', 'role'],
            additionalProperties: {},
          },
        },
      },
      required: ['command', 'matches'],
      additionalProperties: {},
    },
  },
  'rt.notify.eventBridges': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        category: { type: 'string' },
        title: { type: 'string' },
        message: { type: 'string' },
        subjectPrefix: { type: 'string' },
        url: { type: 'string' },
        owner: { type: 'string', const: 'human' },
        surface: { type: 'string' },
      },
      required: ['pattern', 'category', 'title', 'message'],
      additionalProperties: {},
    },
  },
  'gitq.forges': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['gitlab', 'github'] },
        baseUrl: { type: 'string' },
        tokenEnv: { type: 'string' },
      },
      required: ['provider'],
      additionalProperties: {},
    },
    labels: { key: 'host', value: 'forge' },
  },
  'deck.apps': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        published: { type: 'boolean' },
        publicFollowsOverride: { type: 'boolean' },
        passwordHash: { type: 'string' },
        passwordVersion: { type: 'number' },
        override: {
          type: 'object',
          properties: {
            devPort: { type: 'number' },
            basePort: { type: 'number' },
          },
          required: ['devPort', 'basePort'],
          additionalProperties: {},
        },
      },
      additionalProperties: {},
    },
  },
  'board.members': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        name: { type: 'string' },
        hidden: { type: 'boolean' },
        agePublicKey: { type: 'string' },
      },
      required: ['username'],
      additionalProperties: {},
    },
  },
};

/** Keys whose registry def merges deep, so their wire def carries a layer
    schema. */
export const DEEP_KEYS = new Set([
  'rt.homeSnapshot',
  'rt.runaway',
  'rt.cron',
  'rt.roles',
  'gitq.forges',
  'deck.apps',
]);

/** rt-client's layerJsonSchema: every `required` dropped except inside
    array items, because deep merge replaces arrays whole. */
export function layerOf(schema: JsonSchema): JsonSchema {
  return relax(schema, false) as JsonSchema;
}

function relax(node: unknown, insideArray: boolean): unknown {
  if (Array.isArray(node)) return node.map(n => relax(n, insideArray));
  if (typeof node !== 'object' || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'required' && !insideArray) continue;
    if (k === 'items' || k === 'prefixItems') out[k] = relax(v, true);
    else if (k === 'properties')
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [
          pk,
          relax(pv, insideArray),
        ])
      );
    else out[k] = relax(v, insideArray);
  }
  return out;
}

export function schemaFields(
  key: string
): Pick<SettingDefWire, 'schema' | 'layerSchema'> {
  const schema = TEST_SCHEMAS[key];
  if (!schema) return {};
  return DEEP_KEYS.has(key)
    ? { schema, layerSchema: layerOf(schema) }
    : { schema };
}
