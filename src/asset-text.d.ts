// Text imports (`with { type: "text" }`) used by server.ts and compiled.ts;
// Bun loads them as strings and embeds them in compiled binaries.
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "*.svg" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
