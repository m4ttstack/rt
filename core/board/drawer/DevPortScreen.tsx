// Dev port screens, per drawer-states-atlas.html "2 · Dev port". Pushed
// screens are rebuilt from the row/nav/board/data current as of the render
// that calls them (ScreenBuilder, not a frozen DrawerScreen value) -- an
// override mutation's own refresh() has to reach this screen's facts the
// same way it already reaches the root's nav-row hint, or revert/save would
// leave the drawer showing stale port state until the row is reopened.
//
// Entering and leaving the setting screen replaces the dev-port slot rather
// than pushing a third stack frame: the atlas's own nav-bar back label reads
// the row name ("‹ atlas") from both the view and the setting screen, which
// only holds if setting sits directly on root, not on top of the view.
import { ListGroup } from "@mattstack/tui-kit";
import { OptimisticToggleRow } from "../optimistic.tsx";
import type { Row, StatusData } from "../logic.ts";
import type { ScreenBuilder } from "./RootScreen.tsx";

/** The board's own row can never carry a real override (see useBoardState's
    startEdit/applyOverride guards) -- mirrors devPortValue's root hint so the
    pushed screen never disagrees with what the row just showed. */
function effectiveOverride(row: Row, data: StatusData): { devPort: number; basePort: number } | null {
  return row.override && data.canManage && !row.self ? row.override : null;
}

function overrideFooter(row: Row, data: StatusData, devPort: number): string {
  return `the proxy routes ${row.name}.${data.suffix} to ${devPort} while the override is set`;
}

function publicFollowsFooter(follows: boolean, basePort: number, devPort: number): string {
  return follows
    ? `on: visitors also get ${devPort} while you develop on it`
    : `off: visitors keep getting ${basePort} while you develop on ${devPort}`;
}

function noOverrideFooter(row: Row): string {
  // The board's own row (self) is structurally exempt from overrides --
  // applyOverride rejects it server-side too -- so it gets a footer that
  // says why, not the ordinary "no override" copy with a dead-end action
  // beneath it.
  return row.self
    ? "deck serves on this port — overrides don't apply to the board itself"
    : `${row.name} serves on its assigned port — no override`;
}

export const buildDevPortSetting: ScreenBuilder = (row, nav, board) => {
  const value = board.editing && board.editing.app === row.name ? board.editing.value : "";
  const back = () => {
    nav.pop();
    nav.push(buildDevPortScreen);
  };
  const save = () => {
    board.submitPort();
    back();
  };
  const cancel = () => {
    board.cancelEdit();
    back();
  };
  return {
    id: `devport-set:${row.name}`,
    title: "dev port",
    navAction: { label: "save", onAction: save, disabled: value.trim() === "" },
    content: (
      <div className="drawer-groups">
        <ListGroup>
          <ListGroup.Fact label="assigned port" value={row.port ?? ""} />
        </ListGroup>
        <ListGroup footer="the port your dev server is listening on right now">
          <ListGroup.Input
            value={value}
            onChange={(ev) => board.setEditValue(ev.target.value)}
            inputRef={(el) => el?.focus()}
            inputMode="numeric"
            placeholder="dev port"
            aria-label="dev port override"
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && value.trim() !== "") save();
              else if (ev.key === "Escape") cancel();
            }}
          />
        </ListGroup>
        <ListGroup>
          <ListGroup.Action label="cancel" onClick={cancel} />
        </ListGroup>
      </div>
    ),
  };
};

export const buildDevPortScreen: ScreenBuilder = (row, nav, board, data) => {
  const override = effectiveOverride(row, data);

  if (override) {
    return {
      id: `devport:${row.name}`,
      title: "dev port",
      content: (
        <div className="drawer-groups">
          <ListGroup footer={overrideFooter(row, data, override.devPort)}>
            <ListGroup.Fact label="assigned port" value={override.basePort} />
            <ListGroup.Fact label="override" value={override.devPort} />
          </ListGroup>
          <ListGroup footer={publicFollowsFooter(row.publicFollowsOverride, override.basePort, override.devPort)}>
            <OptimisticToggleRow
              label="public follows dev"
              checked={row.publicFollowsOverride}
              mutate={() => board.onPublicFollows(row)}
              aria-label={
                row.publicFollowsOverride
                  ? `stop serving ${row.name}'s dev port publicly`
                  : `serve ${row.name}'s dev port publicly`
              }
            />
          </ListGroup>
          <ListGroup>
            <ListGroup.Action label={`revert to ${override.basePort}`} onClick={() => board.clearPort(row)} />
          </ListGroup>
        </div>
      ),
    };
  }

  return {
    id: `devport:${row.name}`,
    title: "dev port",
    content: (
      <div className="drawer-groups">
        <ListGroup footer={noOverrideFooter(row)}>
          <ListGroup.Fact label="assigned port" value={row.port ?? ""} />
        </ListGroup>
        {/* Self's `startEdit` no-ops (useBoardState guards the board's own
            row from ever overriding itself), so this row is never offered
            here -- the old inline UI gated both its entry points on
            `!row.self` the same way. */}
        {!row.self && (
          <ListGroup>
            <ListGroup.Action
              label="set override…"
              onClick={() => {
                board.startEdit(row);
                nav.pop();
                // The kit's own nav-bar back chevron pops this frame directly
                // (bypassing `cancel`'s explicit cancelEdit() above) -- without
                // this, board.editing stays set and refresh() skips every poll
                // behind it (see useBoardState) even after the user has left.
                nav.push(buildDevPortSetting, () => board.cancelEdit());
              }}
            />
          </ListGroup>
        )}
      </div>
    ),
  };
};
