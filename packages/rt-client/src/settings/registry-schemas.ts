/**
 * One zod schema per composite settings key: the value a reader receives.
 * Authoring only: the lock file generated from this is what runs. Objects
 * are loose unless a reader rejects unknown properties. Display metadata
 * (labels, placeholders) rides on .meta() into the JSON Schema.
 */

import { z } from "zod";

export const SCHEMAS = {} satisfies Record<string, z.ZodType>;

export type Value<K extends keyof typeof SCHEMAS> = z.infer<(typeof SCHEMAS)[K]>;
