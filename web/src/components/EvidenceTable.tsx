import type { MetricEvidence } from "../../../shared/types";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Renders any stat's evidence generically: the server decides the columns, rows, links, and
 * which rows are muted (present but not counted, e.g. stale issues). The first cell of a
 * linkable row becomes the deep link. The UI stays dumb ... no per-metric rendering logic.
 *
 * The wide free-text column (Title/Message/Description) wraps and absorbs the slack so the
 * table fits its container; short columns (ids, dates, counts) stay on one line.
 */
export function EvidenceTable({ evidence }: { evidence: MetricEvidence | undefined }) {
  if (!evidence || evidence.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{evidence?.summary ?? "No records behind this stat."}</p>;
  }

  const wrapCol = evidence.columns.findIndex((c) => /title|message|description/i.test(c));

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {evidence.columns.map((c, i) => (
              <TableHead key={c} className={`uppercase tracking-wide ${i === wrapCol ? "w-full" : ""}`}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {evidence.rows.map((row, ri) => (
            <TableRow key={ri} className={row.muted ? "opacity-40" : ""}>
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-3 py-1.5 align-top text-muted-foreground ${
                    ci === wrapCol ? "w-full whitespace-normal break-words" : "whitespace-nowrap"
                  }`}
                >
                  {ci === 0 && row.href ? (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-primary hover:underline"
                    >
                      {cell}
                    </a>
                  ) : (
                    <span className={ci === 0 ? "font-mono text-foreground" : ""}>{cell}</span>
                  )}
                </td>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
