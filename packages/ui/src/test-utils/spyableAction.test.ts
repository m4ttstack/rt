import { describe, expect, it } from 'vitest';

import { spyableAction } from './spyableAction';

describe('spyableAction', () => {
  it('throws from hasBeenCalled() before the spy has been called', () => {
    const spy = spyableAction('onSubmit');

    expect(() => spy.hasBeenCalled()).toThrow(/onSubmit/);
  });

  it('records forwarded args in .mock.calls and returns true from hasBeenCalled() after a call', () => {
    const spy = spyableAction('onSubmit');

    spy('first', 1);
    spy('second', 2);

    expect(spy.mock.calls).toEqual([
      ['first', 1],
      ['second', 2],
    ]);
    expect(spy.hasBeenCalled()).toBe(true);
  });

  it('is a plain callable that forwards whatever args it is given', () => {
    const spy = spyableAction<[string, number]>('onChange');

    spy('value', 42);

    expect(spy.mock.calls[0]).toEqual(['value', 42]);
  });
});
