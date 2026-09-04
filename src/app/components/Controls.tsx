import { useState } from "react";

import {
  Button,
  Group,
  Loader,
  Popover,
  SegmentedControl,
  Text,
  TextInput,
} from "@mattstack/app-kit/core";
import { useSchemeColors } from "@mattstack/app-kit/hooks";
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
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d"];

/** <input type="date"> wants YYYY-MM-DD; the persisted bounds are full ISO timestamps. */
const toDateInput = (iso: string | undefined): string =>
  iso ? iso.slice(0, 10) : "";

/**
 * The leaderboard's action cluster, docked into `PageShell.Header`'s right-aligned
 * `actions` slot. Custom range opens a popover so the whole cluster stays one row.
 */
export function Controls(props: Props) {
  const {
    range,
    start: initialStart,
    end: initialEnd,
    onRange,
    trend,
    onTrend,
    view,
    onView,
    refreshing,
    onRefresh,
  } = props;
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState(() => toDateInput(initialStart));
  const [end, setEnd] = useState(() => toDateInput(initialEnd));
  const { bg, border } = useSchemeColors();

  // The Tokyo surface ladder is compressed, so a SegmentedControl's default
  // track lands on ~the header surface and vanishes. A white track plus a
  // hairline border defines it by outline (the same reason the range button
  // group reads), independent of how close the fills are.
  const segmented = {
    size: "xs" as const,
    color: "accent",
    styles: {
      root: {
        backgroundColor: bg.monochrome,
        border: `1px solid ${border.default}`,
      },
    },
  };

  return (
    <Group gap="md" wrap="nowrap" align="center">
      {/* Zone: time range */}
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
        <Popover
          opened={customOpen}
          onChange={setCustomOpen}
          position="bottom-end"
          withArrow
          shadow="md"
          trapFocus
        >
          <Popover.Target>
            <Button
              size="xs"
              variant={range === "custom" ? "filled" : "default"}
              onClick={() => setCustomOpen((o) => !o)}
            >
              Custom
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Group gap="sm" align="flex-end" wrap="nowrap">
              <TextInput
                label="Start"
                type="date"
                size="xs"
                value={start}
                onTextChange={setStart}
              />
              <TextInput
                label="End"
                type="date"
                size="xs"
                value={end}
                onTextChange={setEnd}
              />
              <Button
                size="xs"
                disabled={!start || !end}
                onClick={() => {
                  onRange(
                    "custom",
                    new Date(start).toISOString(),
                    new Date(end).toISOString(),
                  );
                  setCustomOpen(false);
                }}
              >
                Apply
              </Button>
            </Group>
          </Popover.Dropdown>
        </Popover>
      </Button.Group>

      {/* Zone: comparison. color="accent" fills the active segment; the white
          bordered track (see `segmented`) keeps the whole control legible. */}
      <SegmentedControl
        {...segmented}
        value={trend ? "trend" : "values"}
        onChange={(v) => onTrend(v === "trend")}
        data={[
          { label: "Values", value: "values" },
          { label: "Trend", value: "trend" },
        ]}
      />

      {/* Zone: view mode */}
      <SegmentedControl
        {...segmented}
        value={view}
        onChange={(v) => onView(v as ViewMode)}
        data={[
          { label: "Table", value: "table" },
          { label: "Cards", value: "cards" },
        ]}
      />

      {/* Zone: data action */}
      <Button
        variant="default"
        size="xs"
        disabled={refreshing}
        onClick={onRefresh}
        leftSection={
          refreshing ? <Loader size={12} /> : <Icon name="refresh" size={14} />
        }
      >
        Refresh
      </Button>
    </Group>
  );
}

/** The scope/window/freshness line, docked into `PageShell.Header`'s left. */
export function ControlsMeta({ data }: { data: LeaderboardResponse }) {
  return (
    <Group gap="lg" wrap="nowrap">
      <Text size="xs" c="dimmed" span>
        Scope:{" "}
        <span style={{ color: "var(--mantine-color-text)" }}>
          {data.scope.type === "group"
            ? data.scope.groupPath
            : `${data.scope.projectPaths?.length ?? 0} projects`}
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
  );
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
