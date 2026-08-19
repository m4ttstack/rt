/**
 * The kit's themed builders.
 *
 * Same four builders @soribashi/core exports, re-exported through
 * `makeBuilders<typeof tuiTheme>()` so a recipe's PUBLIC `size` / `intent` /
 * `variant` props narrow to tuiTheme's vocabulary literals (`'accent' | 'ok' |
 * ...`) instead of a bare `string`. makeBuilders returns exactly these four
 * keys — it casts the raw builders, it does not reimplement them, so runtime
 * behaviour is byte-identical to importing them from @soribashi/core and only
 * the declared types change (packages/factory/src/create-builders.ts).
 *
 * The theme import is TYPE-ONLY and there is deliberately no `registerTheme`
 * call here: a value import would put this module downstream of theme.ts, and
 * any per-component `Recipe.extend(...)` entry the theme grows later would then
 * close an import cycle. `createSoribashiBuilders(theme)` is the one-call
 * alternative for setups that cannot form that cycle; the kit takes the split
 * form because recipes arrive in Task 4.
 */
import { makeBuilders } from "@soribashi/core";
import type { tuiTheme } from "./theme.ts";

export const {
  defineComponent,
  definePolymorphicComponent,
  defineCompound,
  defineGenericComponent,
} = makeBuilders<typeof tuiTheme>();
