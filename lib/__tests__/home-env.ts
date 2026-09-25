/**
 * Assigning undefined to a process.env key stores the string "undefined",
 * so a HOME saved while unset must be restored by deleting the key.
 */
export function restoreHome(saved: string | undefined): void {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
}

export function homeProblem(home: string | undefined): string | null {
  if (home === undefined) return "HOME is unset";
  if (!home.startsWith("/")) return `HOME is ${JSON.stringify(home)}, not an absolute path`;
  return null;
}
