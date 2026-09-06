// Entry point for the standalone binary (`bun run build`). The dev form stays
// `bun run src/server.ts`; this wrapper exists because a compiled binary has
// no source tree, so the client bundle must be embedded at build time (the
// text imports below — scripts/build-client.ts writes them first) and handed
// to the server before it boots.
import pkg from "../package.json";
import appJs from "../dist/client/app.js.txt" with { type: "text" };
import appCss from "../dist/client/app.css" with { type: "text" };
import { injectClientAssets } from "./client-assets.ts";
import { runSubcommand } from "./subcommands.ts";

// Bare semver, nothing else: the mattstack bundle gate compares this output
// against the rt-tray deps.lock row verbatim. Answered before the server
// import so a clean machine with no config can still ask.
if (Bun.argv.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}

// The bin/ entry points, for a machine that has only the bundled binary and no
// checkout to `bun run` against: the one-shot triage pass rt cron invokes, and
// the status writers a launched agent pane runs to report back (the board hands
// itself out as --status-bin; see statusBinPath). They are top-level-execution
// scripts, not exported functions: each runs to completion, or lets its
// rejection propagate so a real failure exits non-zero. Anything else falls
// through to the client bundle and server boot below.
if (await runSubcommand(Bun.argv)) {
  process.exit(0);
}

injectClientAssets({ appJs, appCss });
await import("./server.ts");
