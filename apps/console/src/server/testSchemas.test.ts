// @vitest-environment node
import { getDef } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  DEEP_KEYS,
  schemaFields,
  TEST_SCHEMAS,
} from '../app/settings/testSchemas';

describe('test schemas', () => {
  it.each(Object.keys(TEST_SCHEMAS))(
    '%s matches the registry schema and layer schema',
    key => {
      const def = getDef(key);
      expect(def).toBeDefined();
      expect(TEST_SCHEMAS[key]).toEqual(def!.schema);
      expect(schemaFields(key).layerSchema).toEqual(def!.layerSchema);
      expect(DEEP_KEYS.has(key)).toBe(def!.merge === 'deep');
    }
  );
});
