declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

/**
 * Side-effect stylesheet imports — `import "../src/generated/theme.css";` in
 * the browser tier's setup file, and the same form in any consumer app.
 *
 * A shorthand ambient module declaration (no body): the import type-checks
 * and the module's shape is `any`, which is exactly right for a file with no
 * JavaScript exports at all. TypeScript picks the MOST specific wildcard
 * pattern, so `*.module.css` above still wins for CSS-module imports; this
 * only catches plain `.css`.
 */
declare module "*.css";
