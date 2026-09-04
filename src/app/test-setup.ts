// Component test setup (jsdom project only -- see vitest.config.ts). Registers
// @testing-library/jest-dom's matchers and the DOM polyfills Mantine needs (matchMedia,
// ResizeObserver) once per test file, so individual test files don't repeat this boilerplate.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installJsdomPolyfills } from "@mattstack/app-kit/test-utils";

installJsdomPolyfills();

// Without `test.globals: true`, RTL's own auto-cleanup (which relies on a global `afterEach`)
// never registers, so a render from one test leaks into the next test's queries.
afterEach(cleanup);
