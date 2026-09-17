export type DiffClassification = "binary" | "submodule" | "text";

// No --binary flag is ever passed to git diff in this codebase, so content
// checks (e.g. scanning for the literal string "GIT binary patch") can only
// false-positive on text that happens to quote it; only git's own
// "Binary files ... differ" header is a reliable binary signal. Likewise a
// gitlink change is identified by its 160000 mode/index lines, not by the
// "Subproject commit" body text, which a text file can legitimately contain.
export function classifyDiffText(text: string): DiffClassification {
  if (/^Binary files .* differ$/m.test(text)) return "binary";
  if (/^(old|new) mode 160000$/m.test(text) || /^index [0-9a-f.]+ 160000$/m.test(text)) {
    return "submodule";
  }
  return "text";
}
