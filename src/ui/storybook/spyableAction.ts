/**
 * A dependency-free spy for stories and interaction tests.
 *
 * Returns a callable that records every call's arguments in `.mock.calls`
 * (an array of arg-arrays, mirroring the shape of a `vi.fn()`/`jest.fn()`
 * mock) and exposes `.hasBeenCalled()` to assert a callback fired --
 * `.hasBeenCalled()` throws (naming the action) if the spy was never
 * called, otherwise it returns `true`.
 *
 * The reference implementation additionally forwarded each call to
 * `@storybook/addon-actions`' `action()` so calls also showed up in the
 * Storybook Actions panel. This kit does not depend on that addon, so
 * that panel logging is dropped here; if `@storybook/addon-actions` is
 * ever added to the kit, this is the place to layer it back in.
 */
export function spyableAction<TArgs extends unknown[] = unknown[]>(
  name: string
) {
  const calls: TArgs[] = [];

  const spyFunction = (...args: TArgs) => {
    calls.push(args);
  };

  spyFunction.mock = {
    calls,
  };

  spyFunction.hasBeenCalled = () => {
    if (calls.length === 0) {
      throw new Error(
        `Expected "${name}" to have been called, but it was not called.`
      );
    }
    return true;
  };

  return spyFunction;
}
