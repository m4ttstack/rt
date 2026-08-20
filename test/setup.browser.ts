// Registered as `setupFiles` in vitest.browser.config.ts. Imported once so
// every browser-tier test renders against the real generated theme.css
// instead of each test file importing it individually.
//
// This import is also the only thing that makes the kit's dark mechanism
// observable in a test: the theme carries both schemes through `light-dark()`
// and the `.dark` block does nothing but flip `color-scheme`, so a test that
// does not load this file sees every `var(--...)` resolve to nothing rather
// than to the wrong colour.
import "../src/generated/theme.css";
