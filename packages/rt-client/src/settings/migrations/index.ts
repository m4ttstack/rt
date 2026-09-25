/**
 * Registered settings migrations. A step reads a key's stored value at
 * `version` and returns it at `version + 1`; a key's steps must form one
 * unbroken chain ending at its storeVersion (registry.test.ts). A key in
 * RENAMES reads the old keys' store names as older versions of itself, and
 * steps filed under an old key continue its chain. Each step's source
 * schema lives in schemas.ts (authoring only). `rt settings schema diff
 * --draft` inserts entries directly above the two @draft markers; keep
 * them.
 */

import type { MigrationStep } from "../registry-machinery.ts";
import { deleteProperty, renameProperty, setDefault } from "./helpers.ts";

export interface KeyedMigrationStep extends MigrationStep {
  key: string;
}

export const MIGRATION_STEPS: KeyedMigrationStep[] = [
  // @draft-steps
];

export const RENAMES: Record<string, string[]> = {
  // @draft-renames
};
