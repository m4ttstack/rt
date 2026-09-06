import { StatusDot as KitStatusDot } from "@mattstack/tui-kit";
import type { BoardMR } from "../../data.ts";
import { statusReasons } from "./format.ts";

/** The board's own status dot: the wrap, the glyph and the CSS tooltip are all
    the kit's `StatusDot` recipe now. What stays here is the part the kit
    deliberately refused to take -- the DOMAIN derivation. The recipe takes an
    already-classified `intent`/`tip` pair (the same split Chip made for its own
    `intent`), so mapping a BoardMR's blockers onto ok/warn/bad, and its reasons
    onto the tooltip string, is board logic that never crosses the boundary. */
function StatusDot({ mr }: { mr: BoardMR }) {
  const intent = !mr.blockers?.any ? "ok" : mr.blockers.hasConflicts || mr.blockers.pipelineFailing ? "bad" : "warn";
  return <KitStatusDot intent={intent} tip={statusReasons(mr)} />;
}

export { StatusDot };
