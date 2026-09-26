const SUFFIXES: [RegExp, string][] = [
  [/Days$/, 'days'],
  [/(Minutes|Mins|Min)$/, 'min'],
  [/Sec$/, 'sec'],
  [/Hours$/, 'hours'],
];

export function unitOf(keyOrField: string): string | null {
  const last = keyOrField.split('.').at(-1) ?? keyOrField;
  for (const [re, unit] of SUFFIXES) if (re.test(last)) return unit;
  return null;
}
