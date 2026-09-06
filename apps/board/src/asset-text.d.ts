// Text imports (`with { type: "text" }`) used by server.ts and compiled.ts;
// Bun loads them as strings and embeds them in compiled binaries.
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.svg' {
  const text: string;
  export default text;
}
declare module '*.txt' {
  const text: string;
  export default text;
}

// File imports (`with { type: "file" }`): Bun resolves these to a path that
// reads correctly both from a checkout and inside a compiled binary, where
// the file is embedded and extracted to a temp path at runtime.
declare module '*.png' {
  const path: string;
  export default path;
}
