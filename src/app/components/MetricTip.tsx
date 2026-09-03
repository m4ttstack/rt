import { Stack, Text } from "@mattstack/app-kit/core";

import type { Column } from "../columns";

/** Tooltip body for a metric: name, what it measures, and which direction is better. */
export function MetricTip({ col }: { col: Column }) {
  return (
    <Stack gap={2}>
      <Text size="sm" fw={600}>
        {col.label}
      </Text>
      <Text size="xs" style={{ opacity: 0.85 }}>
        {col.description}
      </Text>
      <Text size="10px" tt="uppercase" style={{ letterSpacing: "0.06em", opacity: 0.7 }}>
        {col.better === "asc" ? "↓ lower is better" : "↑ higher is better"} · {col.group}
      </Text>
    </Stack>
  );
}
