// Type-only re-export: erased under verbatimModuleSyntax, so zod never reaches
// rt's runtime bundle through this barrel (see no-zod-in-dist.test.ts).
export type { Value } from "../../packages/rt-client/src/settings/registry-schemas.ts";
