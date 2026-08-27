import { forwardRef } from 'react';
// eslint-disable-next-line no-restricted-imports -- shadow definition site: this IS the `@mattstack/app-kit/core` TextInput the eslint wall (eslint.config.js) points everything else at.
import { TextInput as MantineTextInput } from '@mantine/core';
import type { TextInputProps as MantineTextInputProps } from '@mantine/core';

export interface TextInputProps extends MantineTextInputProps {
  /**
   * Convenience over `onChange`: called with just the new string value.
   * Fires alongside (and after) any `onChange` you also pass.
   */
  onTextChange?: (value: string) => void;
  /** Uppercases keystrokes as they're typed. @default false */
  forceUpperCase?: boolean;
}

/**
 * Kit shadow of `TextInput`. Mantine's input plus a few kit conveniences:
 *  - `autoComplete="off"` -- browser autofill suggestions are noise on most
 *    app fields (identifiers, search boxes, internal names); opt back in
 *    per-field (`autoComplete="email"`, etc.) where it's actually wanted,
 *    e.g. a real login/signup form.
 *  - `onTextChange(value)` -- the new string without unwrapping the event.
 *  - `forceUpperCase` -- uppercases input as it's typed.
 *
 * Size/radius are intentionally NOT re-specified here -- they already follow
 * the kit theme's `defaultRadius`/component defaults (see
 * src/ui/design-system/theme.ts), so every input in the app stays consistent
 * without each shadow re-asserting the same values.
 */
export const TextInput = /* @__PURE__ */ forwardRef<
  HTMLInputElement,
  TextInputProps
>(function TextInput(
  { onTextChange, forceUpperCase, onChange, ...props },
  ref
) {
  return (
    <MantineTextInput
      autoComplete="off"
      {...props}
      ref={ref}
      onChange={event => {
        if (forceUpperCase) {
          const upper = event.currentTarget.value.toUpperCase();
          event.currentTarget.value = upper;
          event.target.value = upper;
        }
        onChange?.(event);
        onTextChange?.(event.currentTarget.value);
      }}
    />
  );
});
