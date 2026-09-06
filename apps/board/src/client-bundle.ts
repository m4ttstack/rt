import { join } from "path";
import type { BunPlugin } from "bun";

// ONE React in the bundle, pinned by resolved path.
//
// @mattstack/tui-kit is a `file:` dependency, and bun links it as a tree of
// per-file symlinks into the sibling checkout. A bundler REALPATHS a leaf
// before resolving that file's own imports, so a kit recipe's bare `react`
// specifier resolves from `~/Documents/GitHub/tui-kit/node_modules/...`, not
// from ours -- and bundlers key module identity by resolved path. The kit
// declares react/react-dom as PEER dependencies (correctly); that is simply
// not something an adopter's install can act on when the kit also has its own
// devDependency copy sitting next to the realpath'd source.
//
// Measured before this plugin existed: `react@19.2.8` from the kit's store AND
// `node_modules/react` from ours, both in one bundle -- so `<Icon>` (the first
// kit recipe the board renders) threw `Cannot read properties of null (reading
// 'useContext')` and React logged "You might have more than one copy of React
// in the same app". Same failure mode, same diagnosis technique, as the
// @soribashi/factory double instance in docs/tui-kit-devloop.md: group the
// emitted bundle's module-path comments by package root.
//
// `Bun.resolveSync` from THIS file's directory always lands in the board's own
// node_modules, so every react/react-dom specifier in the graph -- ours and
// the kit's alike -- collapses onto one copy.
//
// THE FILTER IS DELIBERATELY UNCONDITIONAL, and that is the thing to know if
// you land here chasing a React version conflict: it rewrites EVERY
// react/react-dom specifier in the graph onto the board's copy, third-party
// dependencies included (invadrs and react-markdown both import React today).
// A dependency that genuinely needed a different React major would be silently
// given ours and break at render, not at resolve -- so this plugin, not the
// lockfile, is where that investigation starts.
const reactSingleton: BunPlugin = {
  name: "react-singleton",
  setup(builder) {
    builder.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, import.meta.dir),
    }));
  },
};

export interface ClientBundle {
  appJs: string;
  appCss: string;
}

/**
 * Bundle the React client from source. The dev server calls this at boot and
 * serves the result from memory; scripts/build-client.ts calls it at build
 * time so the compiled binary can embed the outputs instead (a standalone
 * binary has no source tree to bundle from).
 */
export async function buildClientBundle(): Promise<ClientBundle> {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "client", "main.tsx")],
    target: "browser",
    minify: true,
    plugins: [reactSingleton],
  });
  if (!build.success) {
    console.error(build.logs.join("\n"));
    throw new Error("client bundle failed");
  }
  // The client entry imports the kit's theme.css + canvas.css, so the bundle is
  // now a JS chunk *and* a CSS chunk. Discriminate on `kind`, not on the file
  // extension: Bun tags each output ("entry-point" / "asset" / "chunk" /
  // "sourcemap"), so turning on sourcemaps some day adds a `kind: "sourcemap"`
  // output that these counts correctly ignore, while a real regression -- a
  // second entry point, or a code-split chunk the shell does not serve -- still
  // trips the assertion instead of sliding through an extension match.
  //
  // The CSS assertion is the load-bearing one: zero CSS outputs means those two
  // imports silently vanished, which would boot the board with no token block at
  // all (every var(--*) computing to `initial` -- black text on a transparent
  // ground). Better a boot failure than a black board.
  const jsOutputs = build.outputs.filter((o) => o.kind === "entry-point");
  const cssOutputs = build.outputs.filter((o) => o.kind === "asset" && o.path.endsWith(".css"));
  if (jsOutputs.length !== 1) throw new Error(`expected 1 JS entry-point output, got ${jsOutputs.length}`);
  if (cssOutputs.length !== 1) throw new Error(`expected 1 CSS asset output (tui-kit theme + canvas), got ${cssOutputs.length}`);
  return { appJs: await jsOutputs[0]!.text(), appCss: await cssOutputs[0]!.text() };
}
