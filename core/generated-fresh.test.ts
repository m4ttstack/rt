import { expect, test } from "bun:test";
import { buildBoardArtifacts } from "../scripts/build-board.ts";
import COMMITTED_JS from "./generated/board.js" with { type: "text" };
// @ts-expect-error — tsc has no ambient module declaration for a .css text import (with {type:"text"}); runtime is correct, see core/board-assets.test.ts
import COMMITTED_CSS from "./generated/board.css" with { type: "text" };

test("core/generated is fresh — run `bun run build:board` after editing core/board/", async () => {
  const { js, css } = await buildBoardArtifacts();
  expect(js).toBe(COMMITTED_JS as unknown as string);
  expect(css).toBe(COMMITTED_CSS as unknown as string);
}, 30000);
