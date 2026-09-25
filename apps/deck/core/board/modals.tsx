// Add-app modal: the app's directory first, registered from its
// mattstack.deck.json the way `deck register --dir` does; only a directory
// without one gets the hand-filled service form (name, command, directory).
// Edit now lives in the drawer (EditScreen.tsx); remove is triggered from the
// drawer's danger row (RootScreen.tsx) but the confirmation itself stays a
// board-level ConfirmDialog here, per drawer-states-atlas.html's blast-radius
// copy.
import {
  Alert,
  Button,
  ConfirmDialog,
  Modal,
  TextField,
} from '@mattstack/tui-kit';
import { NAME_PATTERN } from './logic.ts';
import type { BoardState } from './useBoardState.ts';

// Stable identity: an inline callback ref re-runs on every render, pulling
// focus back to this field on each keystroke typed into another one.
const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

export function AddAppModal({ board }: { board: BoardState }) {
  const { data, addModal, closeAdd, updateAddModal, submitAdd } = board;
  if (!addModal) return null;
  return (
    <Modal title="Add an app" ariaLabel="Add an app" onClose={closeAdd}>
      <form
        onSubmit={ev => {
          ev.preventDefault();
          submitAdd();
        }}
      >
        <p>
          Registers a local service: a named https domain and a supervised
          process that starts on login.
        </p>
        <div className="modal-form">
          {addModal.step === 'dir' && (
            <>
              <TextField
                label="App directory"
                name="app-dir"
                value={addModal.dir}
                onChange={ev => updateAddModal({ dir: ev.target.value })}
                placeholder="/Users/you/code/myapp"
                required
                pattern="/.*"
                title="an absolute path, starting with /"
                inputRef={focusOnMount}
              />
              <p className="muted">
                Deck sets the app up from its mattstack.deck.json. A directory
                without one asks for the details by hand.
              </p>
            </>
          )}
          {addModal.step === 'manual' && (
            <>
              {addModal.dir && (
                <p className="muted">
                  No mattstack.deck.json in {addModal.dir}, so fill in the
                  details by hand.
                </p>
              )}
              <TextField
                label="Name"
                name="app-name"
                value={addModal.name}
                onChange={ev => updateAddModal({ name: ev.target.value })}
                placeholder="myapp"
                required
                pattern={NAME_PATTERN}
                title="lowercase letters, digits, dots, dashes"
                inputRef={focusOnMount}
              />
              <TextField
                label="Command"
                value={addModal.command}
                onChange={ev => updateAddModal({ command: ev.target.value })}
                placeholder="bun src/server.ts"
                required
              />
              <TextField
                label="Working directory"
                value={addModal.workingDirectory}
                onChange={ev =>
                  updateAddModal({ workingDirectory: ev.target.value })
                }
                placeholder="/Users/you/code/myapp"
                required
              />
              {data && data.nextPort != null && (
                <p className="muted">
                  Will be assigned port {data.nextPort} (PORT env).
                </p>
              )}
            </>
          )}
          {addModal.error && <Alert intent="bad">{addModal.error}</Alert>}
        </div>
        <footer className="modal-footer">
          <Button type="button" onClick={closeAdd}>
            Cancel
          </Button>
          <Button type="submit" busy={addModal.submitting}>
            Add app
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function UnlinkConfirm({ board }: { board: BoardState }) {
  const { pendingUnlink, cancelUnlink, confirmUnlink } = board;
  return (
    <ConfirmDialog
      open={pendingUnlink != null}
      title={pendingUnlink ? `unlink ${pendingUnlink.name}?` : ''}
      onConfirm={confirmUnlink}
      onCancel={cancelUnlink}
      confirmLabel="unlink"
      cancelLabel="cancel"
    >
      the app keeps serving from its installed bundle; dev commands disappear
      until you relink the checkout.
    </ConfirmDialog>
  );
}

export function RemoveConfirm({ board }: { board: BoardState }) {
  const { pendingRemove, cancelRemove, confirmRemove } = board;
  return (
    <ConfirmDialog
      open={pendingRemove != null}
      title={pendingRemove ? `remove ${pendingRemove.name}?` : ''}
      onConfirm={confirmRemove}
      onCancel={cancelRemove}
      confirmLabel="remove app"
      cancelLabel="cancel"
    >
      its route, launchd service, and access config are deleted. the code stays.
    </ConfirmDialog>
  );
}
