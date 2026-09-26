import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import {
  isDiverged,
  issueLine,
  issueText,
  issueWhere,
  type WireIssue,
} from './issues';
import { JsonBlock } from './JsonBlock';

// Two columns share the row down to this width each before wrapping to
// their own full-width rows; `flex-shrink` must stay enabled (1, not 0) so
// a column can still shrink below this basis instead of forcing the row
// wider than the space actually available for it.
const DIVERGED_COL_BASIS = 260;

/** `minWidth: 0` lets a column shrink at all; a flex item's automatic
    minimum size otherwise floors at its content's width. */
const DIVERGED_COL_STYLE = {
  flex: `1 1 ${DIVERGED_COL_BASIS}px`,
  minWidth: 0,
} as const;

const DIVERGED_WRAP_STYLE = { width: '100%', minWidth: 0 } as const;

/** One warning line per stored value that fails its schema or type check,
    and per merged-value failure, each with Fix when the page can open it. */
export function IssueLines({
  def,
  onFix,
  hide,
}: {
  def: SettingDefWire;
  onFix?: (issue: WireIssue | null) => void;
  /** Issues another part of the view already shows (the explain modal's
      layer lines), left out here so the text is not repeated. */
  hide?: (issue: WireIssue) => boolean;
}) {
  const { text } = useSchemeColors();
  const issues = (def.issues ?? []).filter(i => !hide?.(i));
  const merged = def.mergedIssues ?? [];
  if (issues.length === 0 && merged.length === 0) return null;
  const line = (key: string, label: string, fix?: () => void) => (
    <Group key={key} gap={8} wrap="nowrap" data-testid="issue-line">
      <Icons.warning size={12} color="var(--tk-text-warn-vivid)" />
      <Text
        fz={12}
        ff="monospace"
        c="var(--tk-text-warn-small)"
        style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}
      >
        {label}
      </Text>
      {fix && (
        <Button size="compact-xs" variant="default" onClick={fix}>
          Fix
        </Button>
      )}
    </Group>
  );
  return (
    <Stack gap={4} pb={12}>
      {issues.map((issue, i) =>
        isDiverged(issue) ? (
          <Stack
            key={`d${i}`}
            gap={6}
            style={DIVERGED_WRAP_STYLE}
            data-testid={`diverged-${issue.scope}-${issue.storeName}`}
          >
            {line(
              `d${i}`,
              `${issueWhere(issue)} · ${issue.storeName} differs from the current value`,
              onFix ? () => onFix(issue) : undefined
            )}
            {!def.secret && (
              <Group
                gap={12}
                align="flex-start"
                wrap="wrap"
                pl={20}
                style={DIVERGED_WRAP_STYLE}
              >
                <Stack
                  gap={2}
                  style={DIVERGED_COL_STYLE}
                  data-testid="diverged-current"
                >
                  <Text fz={12} c={text.muted}>
                    current
                  </Text>
                  <JsonBlock value={issue.currentValue} maxHeight={160} />
                </Stack>
                <Stack
                  gap={2}
                  style={DIVERGED_COL_STYLE}
                  data-testid="diverged-older"
                >
                  <Text fz={12} c={text.muted}>
                    {`older (${issue.storeName})`}
                  </Text>
                  <JsonBlock value={issue.olderValue} maxHeight={160} />
                </Stack>
              </Group>
            )}
          </Stack>
        ) : (
          line(
            `i${i}`,
            issueLine(issue),
            onFix ? () => onFix(issue) : undefined
          )
        )
      )}
      {merged.map((issue, i) =>
        line(
          `m${i}`,
          `merged · ${issueText(issue)}`,
          onFix ? () => onFix(null) : undefined
        )
      )}
    </Stack>
  );
}
