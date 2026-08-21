import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import { Spinner } from "../Spinner/Spinner.tsx";
import { Switch } from "../Switch/Switch.tsx";
import { TextField, type TextFieldProps } from "../Field/Field.tsx";
import classes from "./ListGroup.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const LISTGROUP_SELECTORS = ["root", "list", "footer"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. Only
    `root`/`list`/`footer` are Styles-API slots (the defineComponent recipe);
    the row parts below are hand-rolled subcomponents that stamp these same
    names directly -- same split as Table's TABLE_PARTS. */
export const LISTGROUP_PARTS = {
  root: "listgroup",
  list: "listgroup-list",
  footer: "listgroup-footer",
  nav: "listgroup-nav",
  toggle: "listgroup-toggle",
  action: "listgroup-action",
  fact: "listgroup-fact",
  input: "listgroup-input",
  label: "listgroup-label",
  value: "listgroup-value",
  chevron: "listgroup-chevron",
} as const;

/** The root's own props; `ListGroupProps` below is the full public surface. */
export interface ListGroupOwnProps {
  /** A single dim sentence rendered under the group -- not per-row, per the
      brief's mock reference. */
  footer?: ReactNode;
  children: ReactNode;
}

type ListGroupProps_ = ListGroupOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

const ListGroupRoot = defineComponent<
  ListGroupProps_,
  typeof LISTGROUP_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "ListGroup",
  selectors: LISTGROUP_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      footer,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <div ref={ref} {...rest} {...getStyles("root")} data-part={LISTGROUP_PARTS.root}>
        <ul {...getStyles("list")} data-part={LISTGROUP_PARTS.list}>
          {children}
        </ul>
        {footer != null && (
          <p {...getStyles("footer")} data-part={LISTGROUP_PARTS.footer}>
            {footer}
          </p>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// Nav -- full-row button, chevron affordance.
// ---------------------------------------------------------------------------

export interface ListGroupNavOwnProps {
  label: ReactNode;
  /** Right-hand dim hint. Wrapped `aria-hidden` alongside the chevron so the
      button's accessible name stays exactly `label` -- the value is a visual
      summary, not a second accessible fact (a Fact row is the place for
      that). */
  value?: ReactNode;
  onClick(): void;
  disabled?: boolean;
}

function Nav({ label, value, onClick, disabled }: ListGroupNavOwnProps) {
  return (
    <li className={classes.item} data-part={LISTGROUP_PARTS.nav}>
      <button
        type="button"
        className={classes.navButton}
        onClick={() => onClick()}
        disabled={disabled}
      >
        <span className={classes.label} data-part={LISTGROUP_PARTS.label}>
          {label}
        </span>
        <span className={classes.trailing} aria-hidden="true">
          {value != null && (
            <span className={classes.value} data-part={LISTGROUP_PARTS.value}>
              {value}
            </span>
          )}
          <span className={classes.chevron} data-part={LISTGROUP_PARTS.chevron}>
            {"›"}
          </span>
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Toggle -- wraps kit Switch.
// ---------------------------------------------------------------------------

export interface ListGroupToggleOwnProps {
  label: ReactNode;
  checked: boolean;
  onChange(): void;
  "aria-label"?: string;
}

function Toggle({ label, checked, onChange, "aria-label": ariaLabel }: ListGroupToggleOwnProps) {
  return (
    <li className={`${classes.item} ${classes.toggleRow}`} data-part={LISTGROUP_PARTS.toggle}>
      <span className={classes.label} data-part={LISTGROUP_PARTS.label}>
        {label}
      </span>
      <Switch
        checked={checked}
        onChange={() => onChange()}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Action / Danger -- full-row button; Danger is Action with intent locked to
// "bad" and rendered centered (the destructive-confirmation shape).
// ---------------------------------------------------------------------------

export interface ListGroupActionOwnProps {
  label: ReactNode;
  onClick(): void;
  /** Renders a Spinner ahead of the label in place of a leading glyph, and
      disables the row -- same shape as Button's own `busy`. */
  busy?: boolean;
  intent?: "accent" | "bad";
  disabled?: boolean;
}

/** Shared by Action and Danger: `centered` is Danger's own addition, not part
    of Action's public prop surface (the brief's Action signature has no such
    prop) -- Danger reaches this render path directly rather than through the
    public Action component to apply it. */
function renderActionRow(props: ListGroupActionOwnProps, centered: boolean) {
  const { label, onClick, busy, intent, disabled } = props;
  return (
    <li className={classes.item} data-part={LISTGROUP_PARTS.action}>
      <button
        type="button"
        className={classes.actionButton}
        data-intent={intent}
        data-centered={centered || undefined}
        onClick={() => onClick()}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
      >
        {busy && <Spinner size="xs" />}
        <span className={classes.label} data-part={LISTGROUP_PARTS.label}>
          {label}
        </span>
      </button>
    </li>
  );
}

function Action(props: ListGroupActionOwnProps) {
  return renderActionRow(props, false);
}

function Danger(props: Omit<ListGroupActionOwnProps, "intent">) {
  return renderActionRow({ ...props, intent: "bad" }, true);
}

// ---------------------------------------------------------------------------
// Fact -- inert.
// ---------------------------------------------------------------------------

export interface ListGroupFactOwnProps {
  label: ReactNode;
  value: ReactNode;
}

function Fact({ label, value }: ListGroupFactOwnProps) {
  return (
    <li className={`${classes.item} ${classes.factRow}`} data-part={LISTGROUP_PARTS.fact}>
      <span className={classes.label} data-part={LISTGROUP_PARTS.label}>
        {label}
      </span>
      <span className={classes.value} data-part={LISTGROUP_PARTS.value}>
        {value}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Input -- kit TextField in a row shell.
// ---------------------------------------------------------------------------

function Input(props: TextFieldProps) {
  return (
    <li className={`${classes.item} ${classes.inputRow}`} data-part={LISTGROUP_PARTS.input}>
      <TextField {...props} />
    </li>
  );
}

export const ListGroup = Object.assign(ListGroupRoot, { Nav, Toggle, Action, Danger, Fact, Input });

/** Everything a call site may pass to the group root, own props included. */
export type ListGroupProps = ComponentProps<typeof ListGroup>;
export type ListGroupNavProps = ListGroupNavOwnProps;
export type ListGroupToggleProps = ListGroupToggleOwnProps;
export type ListGroupActionProps = ListGroupActionOwnProps;
export type ListGroupFactProps = ListGroupFactOwnProps;
export type ListGroupInputProps = TextFieldProps;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const listGroupTheme = ListGroup.extend({});
