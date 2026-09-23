/**
 * Trimmed from github-desktop app/src/lib/fatal-error.ts (MIT, see LICENSE).
 * Only assertNever is vendored; the fatalError machinery is Electron-specific.
 */
export function assertNever(_x: never, message: string): never {
  throw new Error(message)
}

/**
 * Unwrap a value that, according to the type system, could be null or
 * undefined, but which we know is not. If the value _is_ null or undefined,
 * this will throw with the given message.
 */
export function forceUnwrap<T>(message: string, x: T | null | undefined): T {
  if (x == null) {
    throw new Error(message)
  }
  return x
}
