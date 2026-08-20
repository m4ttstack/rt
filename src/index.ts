/**
 * The kit's public barrel — `@mattstack/tui-kit`.
 *
 * RECIPES ONLY. The theme, the hooks family, and the two stylesheets each have
 * their own package.json export subpath (`/theme`, `/hooks`, `/theme.css`,
 * `/canvas.css`) and are deliberately NOT re-exported here: a consumer that
 * wants only `<Icon />` should not pull the theme's value graph in with it, and
 * `src/builders.ts` imports the theme TYPE only precisely to keep that graph
 * acyclic (see its own comment).
 *
 * One block per recipe, alphabetical by recipe name; tasks 9-15 each append
 * theirs. Each block exports, in this order:
 *   1. the component,
 *   2. its `<name>Theme = Recipe.extend({})` convenience entry,
 *   3. any constants the recipe owns (glyph dictionaries, path data, …),
 *   4. its two props types — `<Name>OwnProps` (what the recipe itself defines)
 *      and `<Name>Props` (everything a call site may pass, the builder's free
 *      style/Styles-API surface included).
 *
 * `recipeCategory` is deliberately never re-exported: it is a per-module
 * authoring record that scripts/derive.ts reads off the recipe module directly,
 * and every recipe exporting a symbol of that name would collide here.
 */

export { CHECK_ICON, COPY_ICON, Icon, ICONS, iconTheme } from "./recipes/Icon/Icon.tsx";
export type { IconOwnProps, IconProps } from "./recipes/Icon/Icon.tsx";
