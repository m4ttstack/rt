const BACKGROUND = new Set([
  'background',
  'background-color',
  'background-image',
  'fill',
]);

const isBorderish = property =>
  property.startsWith('border') ||
  property.startsWith('outline') ||
  property === 'scrollbar-color';

// The pre-migration public aliases still resolve to the FILL steps
// (soribashi.config.ts maps each to --color-<family>-500), so reading one as
// a text colour is the fill-as-text violation wearing an older name.
const FILL_ALIAS_HUE = {
  '--accent': 'accent',
  '--green': 'ok',
  '--red': 'bad',
  '--amber': 'warn',
  '--purple': 'purple',
  '--cyan': 'cyan',
  '--gold': 'gold',
};

/**
 * @param {string} property CSS property (kebab-case) or a style-object key
 * @param {string} varName custom property name including the leading `--`
 * @returns {string | null} a message when the pair is a violation
 */
export function classifyTokenUse(property, varName) {
  if (property.startsWith('--')) return null;
  const prop = property.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

  if (/^--surface-[1-4]$/.test(varName) || /^--line-[1-3]$/.test(varName)) {
    return `${varName} is a ramp step; only the tokens file writes it. Use a role (--card, --border) instead.`;
  }
  if (varName.startsWith('--text-')) {
    return prop === 'color' ? null : `${varName}: --text-* is for color only.`;
  }
  if (varName.startsWith('--fill-')) {
    return prop === 'color'
      ? `${varName}: --fill-* is never a text colour; use --text-${varName.slice(7)}.`
      : null;
  }
  const aliasHue = FILL_ALIAS_HUE[varName];
  if (aliasHue) {
    return prop === 'color'
      ? `${varName} aliases the ${aliasHue} fill and is never a text colour; use --text-${aliasHue} (or --text-${aliasHue}-vivid for status).`
      : null;
  }
  if (varName.startsWith('--surface-')) {
    return BACKGROUND.has(prop)
      ? null
      : `${varName}: --surface-* is for background and fill only.`;
  }
  if (varName.startsWith('--border-') || varName === '--border') {
    return isBorderish(prop)
      ? null
      : `${varName}: --border-* is for border and outline properties only.`;
  }
  return null;
}

export const VAR_PATTERN = /var\(\s*(--[a-zA-Z0-9-]+)/g;
