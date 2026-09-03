import { Anchor, Table, Text } from "@mattstack/app-kit/core";

import type { MetricEvidence } from "../../shared/types";

/** Reduced opacity for a row that exists but did not count toward the stat (e.g. a stale issue). */
const MUTED_OPACITY = 0.4;

/**
 * Renders any stat's evidence generically: the server decides the columns, rows, links, and
 * which rows are muted (present but not counted). The first cell of a linkable row becomes the
 * deep link. The UI stays dumb ... no per-metric rendering logic.
 *
 * The wide free-text column (Title/Message/Description) wraps and absorbs the slack so the
 * table fits its container; short columns (ids, dates, counts) stay on one line.
 */
export function EvidenceTable({ evidence }: { evidence: MetricEvidence | undefined }) {
  if (!evidence || evidence.rows.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {evidence?.summary ?? "No records behind this stat."}
      </Text>
    );
  }

  const wrapCol = evidence.columns.findIndex((c) => /title|message|description/i.test(c));

  return (
    <Table withTableBorder radius="md" verticalSpacing={6}>
      <Table.Thead>
        <Table.Tr>
          {evidence.columns.map((c, i) => (
            <Table.Th
              key={c}
              style={{
                width: i === wrapCol ? "100%" : undefined,
                whiteSpace: "nowrap",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {c}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {evidence.rows.map((row, ri) => (
          <Table.Tr
            key={ri}
            data-testid={`evidence-row-${ri}`}
            data-muted={row.muted ? "true" : undefined}
            style={row.muted ? { opacity: MUTED_OPACITY } : undefined}
          >
            {row.cells.map((cell, ci) => (
              <Table.Td
                key={ci}
                style={{
                  verticalAlign: "top",
                  whiteSpace: ci === wrapCol ? "normal" : "nowrap",
                  wordBreak: ci === wrapCol ? "break-word" : undefined,
                  color: "var(--ui-text-muted)",
                }}
              >
                {ci === 0 && row.href ? (
                  <Anchor
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                  >
                    {cell}
                  </Anchor>
                ) : (
                  <Text
                    component="span"
                    size="sm"
                    c={ci === 0 ? "var(--mantine-color-text)" : undefined}
                    style={ci === 0 ? { fontFamily: "var(--mantine-font-family-monospace)" } : undefined}
                  >
                    {cell}
                  </Text>
                )}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
