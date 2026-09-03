import { useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";

import { Badge, Table, Text } from "@mattstack/app-kit/core";
import { useSchemeColors } from "@mattstack/app-kit/hooks";
import { Icon } from "@mattstack/app-kit/icons";

import type { LeaderboardResponse, UserRow } from "../../shared/types";
import {
  COLUMNS,
  type Column,
  GROUP_META,
  GROUP_ORDER,
  deltaValue,
  formatValue,
  rankValue,
  sortValue,
} from "../columns";
import { DeltaBadge } from "./DeltaBadge";
import { MetricTip } from "./MetricTip";
import { Tooltip } from "./Tooltip";

interface Props {
  data: LeaderboardResponse;
  trend: boolean;
}

/** Per-group header accent, matching the design's Delivery (green) / Volume (muted) / Quality (accent) split. */
const GROUP_COLOR: Record<(typeof GROUP_ORDER)[number], string> = {
  delivery: "green",
  volume: "dimmed",
  quality: "accent",
};

const BORDER = "1px solid var(--mantine-color-default-border)";
const STICKY_LEFT: CSSProperties = { position: "sticky", left: 0, zIndex: 1 };

export function LeaderboardTable({ data, trend }: Props) {
  const [sortKey, setSortKey] = useState<string>("mrsMerged");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { bg } = useSchemeColors();

  const sortCol = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]!;

  const rows = useMemo(() => {
    const copy = [...data.users];
    copy.sort((a, b) => {
      const va = sortValue(a.metrics, sortCol);
      const vb = sortValue(b.metrics, sortCol);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return copy;
  }, [data.users, sortCol, sortDir]);

  const onSort = (col: Column) => {
    if (col.key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.better === "asc" ? "asc" : "desc");
    }
  };

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th ta="left" style={{ ...STICKY_LEFT, backgroundColor: bg.level4 }}>
            Person
          </Table.Th>
          {GROUP_ORDER.map((g) => {
            const cols = COLUMNS.filter((c) => c.group === g);
            if (cols.length === 0) return null;
            const meta = GROUP_META[g];
            return (
              <Table.Th key={g} ta="left" colSpan={cols.length} style={{ borderLeft: BORDER }}>
                <Text component="span" size="xs" fw={600} tt="uppercase" c={GROUP_COLOR[g]}>
                  {meta.label}
                </Text>
                {meta.hint && (
                  <Text component="span" size="xs" c="dimmed">
                    {" "}
                    ({meta.hint})
                  </Text>
                )}
              </Table.Th>
            );
          })}
        </Table.Tr>
        <Table.Tr>
          <Table.Th ta="left" style={{ ...STICKY_LEFT, backgroundColor: bg.level4 }}>
            Name
          </Table.Th>
          {COLUMNS.map((col, i) => (
            <Table.Th
              key={col.key}
              ta="right"
              style={{
                borderLeft: i > 0 && COLUMNS[i - 1]!.group !== col.group ? BORDER : undefined,
                color: col.key === sortKey ? "var(--mantine-color-text)" : undefined,
              }}
            >
              <Tooltip content={<MetricTip col={col} />}>
                <span data-testid={`sort-${col.key}`} style={{ cursor: "pointer" }} onClick={() => onSort(col)}>
                  {col.label}
                  {col.key === sortKey && (
                    <Icon
                      name={sortDir === "desc" ? "arrowDown" : "arrowUp"}
                      size={11}
                      style={{ marginLeft: 3, verticalAlign: "middle" }}
                    />
                  )}
                </span>
              </Tooltip>
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Row key={row.username} row={row} trend={trend} sortKey={sortKey} />
        ))}
        {rows.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={COLUMNS.length + 1} ta="center" py="xl" c="dimmed">
              No users configured, or none resolved on the instance.
            </Table.Td>
          </Table.Tr>
        )}
      </Table.Tbody>
    </Table>
  );
}

function Row({ row, trend, sortKey }: { row: UserRow; trend: boolean; sortKey: string }) {
  const [, setLocation] = useLocation();
  const { bg } = useSchemeColors();
  const goToStat = (stat: string) =>
    setLocation(`/user/${encodeURIComponent(row.username)}/${encodeURIComponent(stat)}`);

  const rowBg = row.isCurrentUser ? bg.color("accent") : undefined;

  return (
    <Table.Tr
      data-testid={`row-${row.username}`}
      data-current-user={row.isCurrentUser ? "true" : undefined}
      style={{ backgroundColor: rowBg, opacity: row.resolved ? 1 : 0.5 }}
    >
      <Table.Td style={{ ...STICKY_LEFT, backgroundColor: rowBg ?? bg.level2 }}>
        <button
          onClick={() => goToStat(sortKey)}
          style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
          title="View this person's stat details"
        >
          <Text component="span" fw={row.isCurrentUser ? 600 : 400} c={row.isCurrentUser ? "accent" : undefined}>
            {row.name ?? row.username}
          </Text>
          <Text component="span" size="xs" c="dimmed" ml={4}>
            @{row.username}
          </Text>
        </button>
        {!row.resolved && (
          <Text component="span" size="xs" c="warn" ml={6}>
            unresolved
          </Text>
        )}
      </Table.Td>
      {COLUMNS.map((col, i) => {
        const borderL = i > 0 && COLUMNS[i - 1]!.group !== col.group;
        return (
          <Table.Td
            key={col.key}
            onClick={() => goToStat(col.key)}
            ta="right"
            style={{
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "var(--mantine-font-family-monospace)",
              fontVariantNumeric: "tabular-nums",
              borderLeft: borderL ? BORDER : undefined,
            }}
            title={`${row.name ?? row.username} · ${col.label} details`}
          >
            <Cell row={row} col={col} trend={trend} rank={rankValue(row.metrics, col) ?? undefined} />
          </Table.Td>
        );
      })}
    </Table.Tr>
  );
}

function Cell({
  row,
  col,
  trend,
  rank,
}: {
  row: UserRow;
  col: Column;
  trend: boolean;
  rank: number | undefined;
}) {
  if (trend) {
    const d = deltaValue(row.metrics, col);
    if (d === null || d === 0) {
      return (
        <Text component="span" c="dimmed">
          {d === 0 ? "→ 0" : "—"}
        </Text>
      );
    }
    return <DeltaBadge delta={d} col={col} />;
  }

  const v = sortValue(row.metrics, col);
  const cell = row.metrics[col.key];
  const p90 = col.kind === "dist" ? (cell as { p90: number | null }).p90 : null;
  return (
    <span title={p90 !== null ? `p90: ${p90}h` : undefined}>
      {formatValue(v, col)}
      {row.isCurrentUser && rank !== undefined && (
        <Badge ml={6} size="xs" variant="light" color="accent">
          #{rank}
        </Badge>
      )}
    </span>
  );
}
