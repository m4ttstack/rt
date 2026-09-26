import { describe, expect, it } from "vitest";
import { rewriteDeclarationSource } from "../scripts/fix-dts-extensions.ts";

describe("rewriteDeclarationSource", () => {
  it("rewrites relative .ts / .tsx specifiers to .js", () => {
    const source = [
      'import type { A } from "./a.ts";',
      'export { B } from "../B/B.tsx";',
      'type L = typeof import("./lazy.ts");',
      "",
    ].join("\n");
    expect(rewriteDeclarationSource(source)).toBe(
      [
        'import type { A } from "./a.js";',
        'export { B } from "../B/B.js";',
        'type L = typeof import("./lazy.js");',
        "",
      ].join("\n"),
    );
  });

  it("drops side-effect stylesheet imports, which tsc carries into declaration emit", () => {
    // A recipe's `import "./X.keyframes.css";` reaches the .d.ts verbatim; a
    // consumer type-checking the package without `skipLibCheck` then needs an
    // ambient `*.css` module for a file that declares nothing.
    const source = [
      'import type { ComponentProps } from "react";',
      'import "./Spinner.keyframes.css";',
      "export declare const Spinner: unknown;",
      "",
    ].join("\n");
    expect(rewriteDeclarationSource(source)).toBe(
      [
        'import type { ComponentProps } from "react";',
        "export declare const Spinner: unknown;",
        "",
      ].join("\n"),
    );
  });

  it("leaves a stylesheet default import and non-css side-effect imports alone", () => {
    const source = [
      'import classes from "./X.module.css";',
      'import "./polyfill.js";',
      "",
    ].join("\n");
    expect(rewriteDeclarationSource(source)).toBe(source);
  });
});
