// Logs screen, per drawer-states-atlas.html "4 · Logs, edit, remove" -- the
// stderr modal dies; this is its replacement, not an addition. ScreenBuilder
// rebuilds every render from `row`, so a poll landing new stderr shows up
// here live while the screen is open, the same way the root's own "N lines"
// hint already tracks it -- no separate live-update plumbing needed.
import { ListGroup, type DrawerScreen } from "@mattstack/tui-kit";
import type { ScreenBuilder } from "./RootScreen.tsx";

export const buildLogsScreen: ScreenBuilder = (row): DrawerScreen => {
  const stderr = row.service?.stderr ?? [];
  return {
    id: `logs:${row.name}`,
    title: "logs",
    content: (
      <div className="drawer-groups">
        {stderr.length === 0 ? (
          <ListGroup>
            <ListGroup.Fact label="output" value="no recent output" />
          </ListGroup>
        ) : (
          <>
            <pre className="drawer-logbox">{stderr.join("\n")}</pre>
            <ListGroup footer="recent stderr, newest at the bottom · live">
              <ListGroup.Action
                label="copy all"
                intent="accent"
                onClick={() => {
                  navigator.clipboard?.writeText(stderr.join("\n"));
                }}
              />
            </ListGroup>
          </>
        )}
      </div>
    ),
  };
};
