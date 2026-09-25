// RT-50: the settings check audit lives in @mattstack/rt-client. Every
// existing rt importer of lib/settings/check.ts keeps working unchanged
// through this re-export barrel; the implementation lives at the path below.
export * from "../../packages/rt-client/src/settings/check.ts";
