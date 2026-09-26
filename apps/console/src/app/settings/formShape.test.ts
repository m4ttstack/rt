import { describe, expect, it } from 'vitest';

import {
  addableFields,
  canDraw,
  extraKeys,
  formShape,
  newEntry,
  visibleFields,
} from './formShape';
import { layerOf, TEST_SCHEMAS } from './testSchemas';

describe('formShape', () => {
  it('a list of flat objects is an objectList with its required names', () => {
    const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;
    expect(s.kind).toBe('objectList');
    expect(Object.keys(s.fields)).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'subjectPrefix',
      'url',
      'owner',
      'surface',
    ]);
    expect(s.required).toEqual(['pattern', 'category', 'title', 'message']);
    expect(s.fields.owner!.type).toEqual({ enum: ['human'] });
    expect(s.nested).toEqual([]);
  });

  it('a map of objects with a nested optional property draws it read-only', () => {
    const s = formShape(layerOf(TEST_SCHEMAS['deck.apps']!))!;
    expect(s.kind).toBe('objectMap');
    expect(s.nested).toEqual(['override']);
    expect(s.required).toEqual([]);
    expect(s.labels).toEqual(['name', 'value']);
  });

  it('a map keeps its schema labels', () => {
    expect(formShape(TEST_SCHEMAS['gitq.forges'])!.labels).toEqual([
      'host',
      'forge',
    ]);
  });

  it('a required nested property, or no scalar property at all, is JSON only', () => {
    expect(formShape(TEST_SCHEMAS['rt.intercepts'])).toBeNull();
    expect(
      formShape({
        type: 'array',
        items: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
      })
    ).toBeNull();
    expect(formShape(TEST_SCHEMAS['board.ticketPrefixes'])).toBeNull();
    expect(formShape(undefined)).toBeNull();
  });
});

describe('entries', () => {
  const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;

  it('shows required fields, set optional fields and fields the user added', () => {
    expect(visibleFields(s, { pattern: 'x', url: 'u' }, [])).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'url',
    ]);
    expect(visibleFields(s, {}, ['surface'])).toContain('surface');
  });

  it('offers only optional fields not already shown', () => {
    expect(addableFields(s, { url: 'u' }, ['owner'])).toEqual([
      'subjectPrefix',
      'surface',
    ]);
  });

  it('extra keys are anything the form does not draw', () => {
    expect(extraKeys(s, { pattern: 'x', legacy: 1 })).toEqual(['legacy']);
  });

  it('a new entry takes schema defaults and seeds a required switch off', () => {
    expect(newEntry(s)).toEqual({});
    expect(
      newEntry({
        kind: 'objectList',
        fields: {
          on: { type: 'boolean' },
          mode: { type: { enum: ['a', 'b'] }, default: 'b' },
        },
        nested: [],
        required: ['on', 'mode'],
        labels: ['name', 'value'],
      })
    ).toEqual({ on: false, mode: 'b' });
  });

  it('canDraw needs objects where the form expects them', () => {
    expect(canDraw(s, [{ pattern: 'x' }])).toBe(true);
    expect(canDraw(s, [1])).toBe(false);
    expect(canDraw(s, { a: {} })).toBe(false);
    const map = formShape(TEST_SCHEMAS['gitq.forges'])!;
    expect(canDraw(map, { 'gitlab.example.com': { provider: 'gitlab' } })).toBe(
      true
    );
    expect(canDraw(map, { 'gitlab.example.com': 'gitlab' })).toBe(false);
  });
});
