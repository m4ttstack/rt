import type {
  ChangeEvent,
  ComponentProps,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Field.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code.

    ONE DIRECTORY, THREE RECIPES: TextField, TextArea and RadioGroup share one
    CSS shape (Field.module.css) and one FIELD_PARTS selector surface, so they
    live in one module the way Segmented/LabeledSeg do. */
export const recipeCategory = 1 as const;

/** No single recipe here is named "Field" -- TextField, TextArea and
    RadioGroup are three co-equal family members, not one primary plus
    siblings (contrast Segmented/LabeledSeg). Opts this directory out of
    derive.ts's "primary export named after the directory" guard. */
export const recipeIsFamily = true as const;

const FIELD_SELECTORS = ["root", "label", "input", "error", "option"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. Not every
    recipe in this file uses every part: RadioGroup has no `label`/`error`
    part of its own, TextField/TextArea have no `option` part. */
export const FIELD_PARTS = {
  root: "field",
  label: "field-label",
  input: "field-input",
  error: "field-error",
  option: "field-option",
} as const;

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

/** TextField's own props; `TextFieldProps` below is the full public surface. */
export interface TextFieldOwnProps {
  /** Visible label text; label-less call sites pass `aria-label` instead. */
  label?: ReactNode;
  value: string;
  onChange: (ev: ChangeEvent<HTMLInputElement>) => void;
  error?: string | null;
  /** Reaches the `<input>` directly -- separate from the root ref, which
      `defineComponent` already points at the wrapping `<label>`. */
  inputRef?: Ref<HTMLInputElement>;
  type?: "text" | "password";
}

/** Root element is the `<label>`, so input-facing native attrs (placeholder,
    pattern, required, inputMode, autoComplete, aria-label, onKeyDown, onBlur)
    forward to the `<input>`, not the root -- see the render function's
    `rest` handling below. */
type TextFieldProps_ = TextFieldOwnProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "ref" | "value" | "onChange" | "type">;

export const TextField = defineComponent<
  TextFieldProps_,
  typeof FIELD_SELECTORS,
  readonly [],
  readonly [],
  HTMLLabelElement
>({
  name: "TextField",
  selectors: FIELD_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    // `className`/`style` are dropped here, not left in `rest`: getStyles("root")
    // already merges them onto the label below, and leaving them in `rest`
    // would additionally leak them onto the `<input>` via its own spread --
    // `rest` is otherwise EVERYTHING the input receives, per the forwarding
    // rule this recipe follows.
    const {
      label,
      value,
      onChange,
      error,
      inputRef,
      type,
      className: _className,
      style: _style,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <label ref={ref} {...getStyles("root")} data-part={FIELD_PARTS.root}>
        {label != null && (
          <span {...getStyles("label")} data-part={FIELD_PARTS.label}>
            {label}
          </span>
        )}
        <input
          ref={inputRef}
          type={type ?? "text"}
          value={value}
          onChange={onChange}
          {...rest}
          {...getStyles("input")}
          data-part={FIELD_PARTS.input}
        />
        {error != null && (
          <span {...getStyles("error")} data-part={FIELD_PARTS.error} role="alert">
            {error}
          </span>
        )}
      </label>
    );
  },
});

export type TextFieldProps = ComponentProps<typeof TextField>;

export const textFieldTheme = TextField.extend({});

// ---------------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------------

/** TextArea's own props; `TextAreaProps` below is the full public surface. */
export interface TextAreaOwnProps {
  label?: ReactNode;
  value: string;
  onChange: (ev: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
}

/** Mirrors TextField: root is the `<label>`, native textarea attrs forward to
    the `<textarea>` via `rest`. */
type TextAreaProps_ = TextAreaOwnProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "ref" | "value" | "onChange" | "rows">;

export const TextArea = defineComponent<
  TextAreaProps_,
  typeof FIELD_SELECTORS,
  readonly [],
  readonly [],
  HTMLLabelElement
>({
  name: "TextArea",
  selectors: FIELD_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      label,
      value,
      onChange,
      rows,
      className: _className,
      style: _style,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <label ref={ref} {...getStyles("root")} data-part={FIELD_PARTS.root}>
        {label != null && (
          <span {...getStyles("label")} data-part={FIELD_PARTS.label}>
            {label}
          </span>
        )}
        <textarea
          rows={rows}
          value={value}
          onChange={onChange}
          {...rest}
          {...getStyles("input")}
          data-part={FIELD_PARTS.input}
        />
      </label>
    );
  },
});

export type TextAreaProps = ComponentProps<typeof TextArea>;

export const textAreaTheme = TextArea.extend({});

// ---------------------------------------------------------------------------
// RadioGroup
// ---------------------------------------------------------------------------

/** RadioGroup's own props; `RadioGroupProps` below is the full public
    surface. */
export interface RadioGroupOwnProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: ReactNode }>;
}

/** Root is the `<div role="radiogroup">` itself, so this follows the kit's
    ordinary single-root forwarding rule (Badge/StatusDot): everything left
    in `rest` lands on the root, not on a per-option input. */
type RadioGroupProps_ = RadioGroupOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "onChange">;

export const RadioGroup = defineComponent<
  RadioGroupProps_,
  typeof FIELD_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "RadioGroup",
  selectors: FIELD_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      name,
      value,
      onChange,
      options,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <div ref={ref} role="radiogroup" {...rest} {...getStyles("root")} data-part={FIELD_PARTS.root}>
        {options.map((option) => (
          <label
            key={option.value}
            {...getStyles("option")}
            data-part={FIELD_PARTS.option}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  },
});

export type RadioGroupProps = ComponentProps<typeof RadioGroup>;

export const radioGroupTheme = RadioGroup.extend({});
