import type { BranchEnrichment } from '@mattstack/rt-client';

export interface MrRef {
  /** "43166": String(enrichment iid), or parsed from the field URL tail; null when unparseable. */
  iid: string | null;
  /** Enrichment only ("merged", "opened", ...); null on the field fallback. */
  state: string | null;
  /** Link target: enrichment webUrl, or the field value when it is an http(s) URL. */
  webUrl: string | null;
  /** enrichment mr.pipeline?.status, else null. */
  ciStatus: string | null;
  /** Raw field value for linkless display when it is not a URL; null otherwise. */
  text: string | null;
}

/** The `mr` field is written by pipelines as a bare URL; the iid rides its
    tail. Enrichment wins outright because only it knows state and CI. */
export function mrRef(
  enrichmentMr: BranchEnrichment['mr'] | undefined,
  mrField: string | null
): MrRef | null {
  if (enrichmentMr) {
    return {
      iid: String(enrichmentMr.iid),
      state: enrichmentMr.state,
      webUrl: enrichmentMr.webUrl ?? null,
      ciStatus: enrichmentMr.pipeline?.status ?? null,
      text: null,
    };
  }
  if (!mrField) return null;
  const raw = mrField.trim();
  if (!/^https?:\/\//i.test(raw)) {
    return { iid: null, state: null, webUrl: null, ciStatus: null, text: raw };
  }
  const iid =
    raw.match(/\/(?:merge_requests|pull)\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
  return { iid, state: null, webUrl: raw, ciStatus: null, text: null };
}
