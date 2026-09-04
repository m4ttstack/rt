import { useState } from "react";

import { Button, Group, Loader, SegmentedControl, Stack, Switch, Text, TextInput } from "@mattstack/app-kit/core";
import { Icon } from "@mattstack/app-kit/icons";

import type { LeaderboardResponse, RangePreset } from "../../shared/types";

export type ViewMode = "table" | "cards";

interface Props {
  range: string;
  /** Persisted custom-window bounds (ISO), used to pre-fill the date inputs after a reload. */
  start?: string;
  end?: string;
  onRange: (range: string, start?: string, end?: string) => void;
  trend: boolean;
  onTrend: (v: boolean) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  refreshing: boolean;
  onRefresh: () => void;
  data: LeaderboardResponse | null;
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d"];

/** <input type="date"> wants YYYY-MM-DD; the persisted bounds are full ISO timestamps. */
const toDateInput = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : "");

export function Controls(props: Props) {
  const { range, start: initialStart, end: initialEnd, onRange, trend, onTrend, view, onView, refreshing, onRefresh, data } = props;
  const [customOpen, setCustomOpen] = useState(range === "custom");
  const [start, setStart] = useState(() => toDateInput(initialStart));
  const [end, setEnd] = useState(() => toDateInput(initialEnd));

  return (
    <Stack gap="sm" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <Group gap="md" wrap="wrap" align="center">
        <Button.Group>
          {PRESETS.map((p) => (
            <Button
              key={p}
              size="xs"
              variant={range === p ? "filled" : "default"}
              onClick={() => {
                setCustomOpen(false);
                onRange(p);
              }}
            >
              {p}
            </Button>
          ))}
          <Button
            size="xs"
            variant={range === "custom" ? "filled" : "default"}
            onClick={() => setCustomOpen((o) => !o)}
          >
            Custom
          </Button>
        </Button.Group>

        <Switch label="Trend vs prior" checked={trend} onChange={(e) => onTrend(e.currentTarget.checked)} />

        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => onView(v as ViewMode)}
          data={[
            { label: "Table", value: "table" },
            { label: "Cards", value: "cards" },
          ]}
        />

        <Button
          variant="default"
          size="xs"
          ml="auto"
          disabled={refreshing}
          onClick={onRefresh}
          leftSection={refreshing ? <Loader size={12} /> : <Icon name="refresh" size={14} />}
        >
          Refresh
        </Button>
      </Group>

      {customOpen && (
        <Group gap="sm" align="flex-end">
          <TextInput label="Start" type="date" size="xs" value={start} onTextChange={setStart} />
          <TextInput label="End" type="date" size="xs" value={end} onTextChange={setEnd} />
          <Button
            size="xs"
            disabled={!start || !end}
            onClick={() => onRange("custom", new Date(start).toISOString(), new Date(end).toISOString())}
          >
            Apply
          </Button>
        </Group>
      )}

      {data && (
        <Group gap="lg">
          <Text size="xs" c="dimmed" span>
            Scope:{" "}
            <span style={{ color: "var(--mantine-color-text)" }}>
              {data.scope.type === "group" ? data.scope.groupPath : `${data.scope.projectPaths?.length ?? 0} projects`}
            </span>
          </Text>
          <Text size="xs" c="dimmed" span>
            Window:{" "}
            <span style={{ color: "var(--mantine-color-text)" }}>
              {fmtDate(data.window.start)} → {fmtDate(data.window.end)}
            </span>
          </Text>
          <Text size="xs" c="dimmed" span>
            {data.fromCache ? "cached" : "fresh"}
          </Text>
          {data.hasTrend && data.priorWindow && (
            <Text size="xs" c="accent" span>
              trend vs {fmtDate(data.priorWindow.start)}+
            </Text>
          )}
        </Group>
      )}
    </Stack>
  );
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
