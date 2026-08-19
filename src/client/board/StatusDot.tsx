import type { BoardMR } from "../../data.ts";
import { statusReasons } from "./format.ts";

function StatusDot({ mr }: { mr: BoardMR }) {
  const cls = !mr.blockers?.any ? "ok" : mr.blockers.hasConflicts || mr.blockers.pipelineFailing ? "bad" : "warn";
  return (
    <span className="tui-dot-wrap" data-tip={statusReasons(mr)}>
      <span className={`tui-dot ${cls}`}>●</span>
    </span>
  );
}

export { StatusDot };
