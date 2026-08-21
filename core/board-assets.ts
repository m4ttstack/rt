// readFileSync(import.meta.dir…) dies under --compile; static imports embed the
// assets in the binary and behave identically under plain `bun run`.
import BOARD_JS from "./generated/board.js" with { type: "text" };
// @ts-expect-error — tsc has no ambient module declaration for a .css text import (with {type:"text"}); runtime is correct, see core/board-assets.test.ts
import BOARD_CSS from "./generated/board.css" with { type: "text" };

const CACHE = "no-cache";

const BOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck</title>
<link rel="stylesheet" href="/board.css">
</head>
<body>
<div id="root"></div>
<noscript><main class="board"><p>this board needs JavaScript to show live status.</p></main></noscript>
<script src="/board.js" type="module"></script>
</body>
</html>`;

export function boardHtml(): Response {
  return new Response(BOARD_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardJs(): Response {
  return new Response(BOARD_JS as unknown as string, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE },
  });
}

export function boardCss(): Response {
  return new Response(BOARD_CSS as unknown as string, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": CACHE },
  });
}
