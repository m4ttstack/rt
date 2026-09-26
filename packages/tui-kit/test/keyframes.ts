/**
 * Computed `animation-name` reports the SPECIFIED ident whether or not any
 * loaded `@keyframes` rule carries that name, so `!== "none"` stays green on
 * an element that never moves (oven-sh/bun#18921 is exactly that: a hashed
 * `@keyframes` next to an unhashed reference). This walks every readable
 * sheet, descending into grouping rules (`@layer`, `@media`, `@supports`),
 * for a `CSSKeyframesRule` named exactly what the element resolved to.
 */
export function hasKeyframesRule(name: string): boolean {
  const walk = (rules: CSSRuleList): boolean => {
    for (const rule of rules) {
      if (rule instanceof CSSKeyframesRule && rule.name === name) return true;
      if (rule instanceof CSSGroupingRule && walk(rule.cssRules)) return true;
    }
    return false;
  };
  for (const sheet of document.styleSheets) {
    try {
      if (walk(sheet.cssRules)) return true;
    } catch {
      // A cross-origin sheet throws on `cssRules`; none of the kit's are.
    }
  }
  return false;
}

/** `found` is true only when `el` names an animation AND some loaded sheet
    declares `@keyframes` under that exact name. */
export function animationResolution(el: Element): { name: string; found: boolean } {
  const name = getComputedStyle(el).animationName;
  return { name, found: name !== "none" && hasKeyframesRule(name) };
}
