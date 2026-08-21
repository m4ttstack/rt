import { join } from "path";
import type { BunPlugin } from "bun";

const ROOT = join(import.meta.dir, "..");

// The file: kit is realpath'd by the bundler, so a kit recipe's bare `react`
// import resolves inside the kit's own store — two Reacts, two soribashi
// contexts, broken theming. Pin every react specifier to this repo's copy.
// Reference: mr-board src/server.ts reactSingleton.
const reactSingleton: BunPlugin = {
  name: "react-singleton",
  setup(builder) {
    builder.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, ROOT),
    }));
  },
};

export async function buildBoardArtifacts(): Promise<{ js: string; css: string }> {
  const build = await Bun.build({
    entrypoints: [join(ROOT, "core/board/main.tsx")],
    target: "browser",
    minify: true,
    plugins: [reactSingleton],
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  let js = "";
  let css = "";
  for (const out of build.outputs) {
    if (out.kind === "entry-point") js = await out.text();
    if (out.kind === "asset" && out.path.endsWith(".css")) css += await out.text();
  }
  if (!js || !css) throw new Error("board build missing js or css output");
  return { js, css };
}

if (import.meta.main) {
  const { js, css } = await buildBoardArtifacts();
  await Bun.write(join(ROOT, "core/generated/board.js"), js);
  await Bun.write(join(ROOT, "core/generated/board.css"), css);
  console.log("core/generated/board.{js,css} written");
}
