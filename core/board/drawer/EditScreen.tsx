// Edit screen, per drawer-states-atlas.html "4 · Logs, edit, remove", edit
// phone. Command + directory exist only for managed apps -- external apps
// show name and base port only, same split the add-app modal makes on entry.
import { ListGroup } from "@mattstack/tui-kit";
import type { EditModalState } from "../useBoardState.ts";
import type { ScreenBuilder } from "./RootScreen.tsx";

const NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

const FIELD_FOOTER = "command and directory only exist for managed apps — external apps show name and port only";

function isSaveable(m: EditModalState): boolean {
  if (!NAME_PATTERN.test(m.name.trim())) return false;
  if (m.port.trim() === "") return false;
  if (m.kind === "service" && (m.command.trim() === "" || m.workingDirectory.trim() === "")) return false;
  return true;
}

export const buildEditScreen: ScreenBuilder = (row, nav, board) => {
  const m = board.editModal;

  // Transient: submitEdit() clears editModal on success and this screen's
  // own onLeave hasn't popped the frame yet for that same render.
  if (!m) {
    return { id: `edit:${row.name}`, title: "edit app", content: null };
  }

  const managed = m.kind === "service";
  const saveable = isSaveable(m);
  const save = async () => {
    if (await board.submitEdit()) nav.pop();
  };

  return {
    id: `edit:${row.name}`,
    title: "edit app",
    navAction: { label: "save", onAction: save, disabled: !saveable },
    content: (
      <div className="drawer-groups">
        <ListGroup footer={managed ? undefined : FIELD_FOOTER}>
          {/* The API returns one message, not a per-field map -- it lands on
              name, the field every rejection (conflict, bad pattern) traces
              back to. */}
          <ListGroup.Input
            label="name"
            value={m.name}
            onChange={(ev) => board.updateEditModal({ name: ev.target.value })}
            error={m.error}
            pattern="[a-z0-9][a-z0-9.-]*"
            required
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && saveable) save();
            }}
          />
          <ListGroup.Input
            label="base port"
            value={m.port}
            onChange={(ev) => board.updateEditModal({ port: ev.target.value })}
            inputMode="numeric"
            required
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && saveable) save();
            }}
          />
        </ListGroup>
        {managed && (
          <ListGroup footer={FIELD_FOOTER}>
            <ListGroup.Input
              label="command"
              value={m.command}
              onChange={(ev) => board.updateEditModal({ command: ev.target.value })}
              required
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && saveable) save();
              }}
            />
            <ListGroup.Input
              label="directory"
              value={m.workingDirectory}
              onChange={(ev) => board.updateEditModal({ workingDirectory: ev.target.value })}
              required
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && saveable) save();
              }}
            />
          </ListGroup>
        )}
      </div>
    ),
  };
};
