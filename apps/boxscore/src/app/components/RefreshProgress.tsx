import { useEffect, useRef, useState } from "react";

import { Button, Paper, Text } from "@mattstack/app-kit/core";

import type { RefreshProgress as Progress } from "../../shared/types";
import { progressKey, stallNotice } from "../lib/progress";
import styles from "./RefreshProgress.module.css";

interface Props {
  progress: Progress | null;
  onCancel: () => void;
}

export function RefreshProgress({ progress, onCancel }: Props) {
  // The server sends a human label with every progress event; phase is the raw fallback.
  const label = progress ? progress.label || progress.phase : "Starting…";
  const determinate = !!progress && progress.total > 0;
  const pct = determinate ? Math.round((progress.done / progress.total) * 100) : null;

  // A single stalled request holds the count still. Without this the bar looks healthy the
  // whole time and there's no way to tell "working" from "wedged".
  const stalled = stallNotice(useIdleMs(progressKey(progress)));

  return (
    <Paper
      withBorder
      radius="md"
      px="md"
      py="xs"
      mt="md"
      data-testid="refresh-progress"
      data-state={determinate ? "determinate" : "indeterminate"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderColor: stalled ? "var(--mantine-color-warn-6)" : undefined,
        backgroundColor: stalled ? "var(--mantine-color-warn-light)" : undefined,
      }}
    >
      <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
        Refreshing · {label}
      </Text>

      {stalled && (
        <Text size="xs" c="warn" style={{ whiteSpace: "nowrap" }}>
          {stalled}
        </Text>
      )}

      <div className={styles.track} data-testid="refresh-progress-track">
        {determinate ? (
          <div
            className={stalled ? `${styles.determinate} ${styles.determinateStalled}` : styles.determinate}
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className={styles.indeterminate} />
        )}
      </div>

      {determinate && (
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {progress.done}/{progress.total}
        </Text>
      )}

      <Button size="xs" variant="default" onClick={onCancel}>
        Cancel
      </Button>
    </Paper>
  );
}

/** Milliseconds since `key` last changed, re-rendering once a second while it holds. */
function useIdleMs(key: string): number {
  const changedAt = useRef(Date.now());
  const [idleMs, setIdleMs] = useState(0);

  useEffect(() => {
    changedAt.current = Date.now();
    setIdleMs(0);
  }, [key]);

  useEffect(() => {
    const timer = setInterval(() => setIdleMs(Date.now() - changedAt.current), 1_000);
    return () => clearInterval(timer);
  }, []);

  return idleMs;
}
