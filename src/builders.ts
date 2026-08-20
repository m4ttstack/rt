/**
 * The kit's themed builders: the same four @soribashi/core exports, re-exported
 * through `makeBuilders<typeof tuiTheme>()` so a recipe's public `size` /
 * `intent` / `variant` props narrow to tuiTheme's vocabulary literals instead
 * of a bare `string`. It casts the raw builders rather than reimplementing
 * them, so runtime behaviour is unchanged and only the declared types differ.
 *
 * The theme import is TYPE-ONLY on purpose: a value import would put this
 * module downstream of theme.ts, and any per-component `Recipe.extend(...)`
 * entry the theme grows later would then close an import cycle.
 */
import { makeBuilders } from "@soribashi/core";
import type { tuiTheme } from "./theme.ts";

export const {
  defineComponent,
  definePolymorphicComponent,
  defineCompound,
  defineGenericComponent,
} = makeBuilders<typeof tuiTheme>();
