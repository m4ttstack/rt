import { describe, expect, it } from 'vitest';

import type { ConfigDef } from './shapes';
import { rowKind, shapeOf } from './shapes';

const STRING_LIST = { type: 'array', items: { type: 'string' } };
const SIZE_BAND = {
  type: 'object',
  properties: { tooSmall: { type: 'number' }, tooLarge: { type: 'number' } },
  additionalProperties: {},
};
const ROSTER = {
  type: 'array',
  items: {
    type: 'object',
    properties: { username: { type: 'string' }, name: { type: 'string' } },
    required: ['username'],
    additionalProperties: {},
  },
};

function def(key: string, over: Partial<ConfigDef> = {}): ConfigDef {
  return {
    key,
    type: 'array',
    scopes: ['team'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...over,
  };
}

describe('shapeOf', () => {
  it('a string array is a string list', () => {
    expect(shapeOf(def('boxscore.projects', { schema: STRING_LIST }))).toEqual({
      kind: 'stringList',
    });
  });

  it('number leaves keep their fields', () => {
    expect(
      shapeOf(def('boxscore.sizeBand', { type: 'object', schema: SIZE_BAND }))
    ).toEqual({
      kind: 'leaves',
      fields: { tooSmall: 'number', tooLarge: 'number' },
    });
  });

  it('the roster keeps its own editor whatever the schema says', () => {
    expect(shapeOf(def('mattstack.roster', { schema: ROSTER }))).toEqual({
      kind: 'roster',
    });
  });

  it('a string leaf has no editor, since LeavesControl only draws NumberInput', () => {
    expect(
      shapeOf(
        def('boxscore.label', {
          type: 'object',
          schema: {
            type: 'object',
            properties: {
              tooSmall: { type: 'number' },
              title: { type: 'string' },
            },
            additionalProperties: {},
          },
        })
      )
    ).toBeUndefined();
  });

  it('leaves boxscore cannot draw, and unknown shapes, have no editor', () => {
    expect(
      shapeOf(
        def('boxscore.flags', {
          type: 'object',
          schema: {
            type: 'object',
            properties: { on: { type: 'boolean' } },
          },
        })
      )
    ).toBeUndefined();
    expect(
      shapeOf(def('boxscore.mystery', { schema: undefined }))
    ).toBeUndefined();
    expect(rowKind(def('boxscore.mystery', { schema: undefined }))).toBe(
      'readonly'
    );
  });
});
