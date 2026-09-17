/**
 * Trimmed from github-desktop app/src/lib/fatal-error.ts (MIT, see LICENSE).
 * Only assertNever is vendored; the fatalError machinery is Electron-specific.
 */
export function assertNever(_x: never, message: string): never {
  throw new Error(message)
}
