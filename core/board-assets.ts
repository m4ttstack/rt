// core/board-assets.ts — readFileSync(import.meta.dir…) dies under --compile;
// static imports embed the assets in the binary and behave identically under
// plain `bun run` (the non-negotiable checkout boot).
import BOARD_HTML from "./board.html" with { type: "text" };
import BOARD_JS from "./board.js" with { type: "text" };
// @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
import oatCssPath from "./vendor/oat.min.css" with { type: "file" };
import oatJsPath from "./vendor/oat.min.js" with { type: "file" };
import lucidePath from "./vendor/lucide.min.js" with { type: "file" };
import alpinePath from "./vendor/alpine.min.js" with { type: "file" };

// Exact-name allowlist: /vendor/<name> resolves through this map only, so a
// crafted path can never reach outside src/vendor.
const VENDOR: Record<string, { path: string; type: string }> = {
  "oat.min.css": { path: oatCssPath, type: "text/css; charset=utf-8" },
  // @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
  "oat.min.js": { path: oatJsPath, type: "text/javascript; charset=utf-8" },
  // @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
  "lucide.min.js": { path: lucidePath, type: "text/javascript; charset=utf-8" },
  // @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
  "alpine.min.js": { path: alpinePath, type: "text/javascript; charset=utf-8" },
};

// no-cache means revalidate every request, not "don't cache": right for files
// that change only on deploy or a by-hand vendor bump.
const CACHE = "no-cache";

export function boardHtml(): Response {
  // @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
  return new Response(BOARD_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardJs(): Response {
  // @ts-expect-error — tsc doesn't narrow module types by import attribute (with {type:...}); runtime is correct, see core/board-assets.test.ts
  return new Response(BOARD_JS, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE },
  });
}

export function vendorAsset(name: string): Response | null {
  if (!Object.hasOwn(VENDOR, name)) return null;
  const { path, type } = VENDOR[name]!;
  return new Response(Bun.file(path), {
    headers: { "content-type": type, "cache-control": CACHE },
  });
}
