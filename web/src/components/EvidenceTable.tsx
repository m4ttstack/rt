import type { MetricEvidence } from "../../../shared/types";

/**
 * Renders any stat's evidence generically: the server decides the columns, rows, links, and
 * which rows are muted (present but not counted, e.g. stale issues). The first cell of a
 * linkable row becomes the deep link. The UI stays dumb ... no per-metric rendering logic.
 */
export function EvidenceTable({ evidence }: { evidence: MetricEvidence | undefined }) {
  if (!evidence || evidence.rows.length === 0) {
    return <p className="text-sm text-slate-500">{evidence?.summary ?? "No records behind this stat."}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-500">
            {evidence.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evidence.rows.map((row, ri) => (
            <tr
              key={ri}
              className={`border-b border-white/5 last:border-0 ${row.muted ? "opacity-40" : "hover:bg-white/[0.03]"}`}
            >
              {row.cells.map((cell, ci) => (
                <td key={ci} className="whitespace-nowrap px-3 py-1.5 align-top text-slate-300">
                  {ci === 0 && row.href ? (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-indigo-300 hover:text-indigo-200 hover:underline"
                    >
                      {cell}
                    </a>
                  ) : (
                    <span className={ci === 0 ? "font-mono text-slate-200" : ""}>{cell}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
