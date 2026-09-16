/**
 * Browser-safe entry point (the "./gate" subpath export): the pure gate
 * helpers only, so a browser bundle (mattstack-apps gate-kit) never drags in
 * commands.ts's Node-only neighbors the way importing from "." would.
 */
export * from "./gate-answers.ts";
export * from "./gate-options.ts";
export * from "./gate-presentation.ts";
