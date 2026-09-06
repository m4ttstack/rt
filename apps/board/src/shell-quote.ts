/** Wrap a string in single quotes for safe use in a double-and-single-quote shell command. */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
