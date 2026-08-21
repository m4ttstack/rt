// Add-app modal, ported field-for-field from board.html's <dialog> and
// board.js's switch-before-name-field ordering. Edit now lives in the drawer
// (EditScreen.tsx); remove is triggered from the drawer's danger row
// (RootScreen.tsx) but the confirmation itself stays a board-level
// ConfirmDialog here, per drawer-states-atlas.html's blast-radius copy.
import { Alert, Button, ConfirmDialog, Modal, Switch, TextField } from "@mattstack/tui-kit";
import type { BoardState } from "./useBoardState.ts";

export function AddAppModal({ board }: { board: BoardState }) {
  const { data, addModal, closeAdd, updateAddModal, submitAdd } = board;
  if (!addModal) return null;
  return (
    <Modal title="Add an app" ariaLabel="Add an app" onClose={closeAdd}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          submitAdd();
        }}
      >
        <p>
          Registers a local service: a named https domain, and (unless it runs itself) a supervised process
          that starts on login.
        </p>
        <div className="modal-form">
          {/* Switch first: see board.html's own note on why the Name label
              must not precede it. */}
          <Switch
            checked={addModal.external}
            onChange={(ev) => updateAddModal({ external: ev.target.checked })}
            label="I run this myself — just route a port"
            aria-label={
              addModal.external ? "stop routing only, let Local run this app" : "route only — this app runs itself"
            }
            title={addModal.external ? "runs itself — Local only routes a port to it" : "Local runs it via launchd"}
          />
          <TextField
            label="Name"
            name="app-name"
            value={addModal.name}
            onChange={(ev) => updateAddModal({ name: ev.target.value })}
            placeholder="myapp"
            required
            pattern="[a-z0-9][a-z0-9.-]*"
            title="lowercase letters, digits, dots, dashes"
            inputRef={(el) => el?.focus()}
          />
          {!addModal.external && (
            <>
              <TextField
                label="Command"
                value={addModal.command}
                onChange={(ev) => updateAddModal({ command: ev.target.value })}
                placeholder="bun src/server.ts"
                required
              />
              <TextField
                label="Working directory"
                value={addModal.workingDirectory}
                onChange={(ev) => updateAddModal({ workingDirectory: ev.target.value })}
                placeholder="/Users/you/code/myapp"
                required
              />
              {data && data.nextPort != null && (
                <p className="muted">Will be assigned port {data.nextPort} (PORT env).</p>
              )}
            </>
          )}
          {addModal.external && (
            <TextField
              label="Port it listens on"
              value={addModal.staticPort}
              onChange={(ev) => updateAddModal({ staticPort: ev.target.value })}
              inputMode="numeric"
              placeholder="4200"
              required
            />
          )}
          {addModal.error && <Alert intent="bad">{addModal.error}</Alert>}
        </div>
        <footer className="modal-footer">
          <Button type="button" onClick={closeAdd}>
            Cancel
          </Button>
          <Button type="submit">Add app</Button>
        </footer>
      </form>
    </Modal>
  );
}

export function RemoveConfirm({ board }: { board: BoardState }) {
  const { pendingRemove, cancelRemove, confirmRemove } = board;
  return (
    <ConfirmDialog
      open={pendingRemove != null}
      title={pendingRemove ? `remove ${pendingRemove.name}?` : ""}
      onConfirm={confirmRemove}
      onCancel={cancelRemove}
      confirmLabel="remove app"
      cancelLabel="cancel"
    >
      its route, launchd service, and access config are deleted. the code stays.
    </ConfirmDialog>
  );
}
