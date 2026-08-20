/**
 * The kit's app-entry wiring — `@mattstack/tui-kit/provider`.
 *
 * An adopter MUST reach these two through the kit rather than importing them
 * from `@soribashi/core` directly: bundlers key module identity by resolved
 * path, and an adopter's own `@soribashi/core` resolves down a different path
 * than the kit's files do — yielding two `SoribashiContext` objects and a
 * silent fallback to the DEFAULT theme, with no error anywhere. See
 * docs/decisions.md for the full mechanism and the measurement.
 *
 * A subpath as well as a barrel re-export because an app entry usually wants
 * only the wiring, and the barrel drags every recipe's module graph with it.
 */
export { registerTheme, SoribashiProvider } from "@soribashi/core";
