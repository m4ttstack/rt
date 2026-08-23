/**
 * `files` maps a request path (`/assets/index-A_Hb6g66.css`) to the on-disk
 * (or, once compiled, `/$bunfs/...`) path Bun's `with { type: 'file' }`
 * import resolved for it. `indexHtmlPath` is the SPA-fallback target for
 * every non-API, non-asset GET.
 */
export interface EmbeddedManifest {
  indexHtmlPath: string;
  files: Record<string, string>;
}
