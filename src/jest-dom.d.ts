// vitest.setup.ts (repo root, outside tsconfig.app.json's `include`) is what
// registers the matchers at runtime; this file's only job is bringing the
// `vitest` module augmentation into the `src` program so tsc sees them too.
import '@testing-library/jest-dom/vitest';
