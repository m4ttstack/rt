// Password + Google sign-in gates, ported field-for-field from board.html's
// access <dialog> and board.js's access functions. Copy, field order, and the
// domains-before-emails radio order are verbatim.
import { Alert, Button, Modal, RadioGroup, Switch, TextArea, TextField } from "@mattstack/tui-kit";
import type { BoardState } from "./useBoardState.ts";

export function AccessModal({ board }: { board: BoardState }) {
  const { accessModal, closeAccess, updateAccessModal, onPasswordSwitch, savePassword, onOauthSwitch, onOauthMode, applyOauth } =
    board;
  if (!accessModal) return null;
  const m = accessModal;

  return (
    <Modal title={`Access · ${m.app}`} ariaLabel={`Access · ${m.app}`} onClose={closeAccess}>
      {m.published && m.publicUrl && <p>{`Published at ${m.publicUrl}`}</p>}
      {/* Published is a setting; a public URL needs a bound domain. Until one
          is bound, publicUrl is null on every row, so this branch keeps the
          header from ever printing "Published at null". */}
      {m.published && !m.publicUrl && (
        <p>Published, but no public URL yet: bind a domain to reach it from outside.</p>
      )}
      {!m.published && <p>Not published. These gates apply once it is.</p>}

      <div className="modal-form">
        <section className="access-section">
          <Switch
            checked={m.hasPassword || m.pwOpen}
            onChange={onPasswordSwitch}
            label="Password protected"
            title={
              m.hasPassword ? "a password is required, click to remove it" : "no password, click to set one"
            }
            aria-label={m.hasPassword ? "remove the password" : "require a password"}
          />
          {(m.hasPassword || m.pwOpen) && (
            <span className="access-section">
              {m.hasPassword && (
                <p className="muted">A password is set. Changing it signs out anyone holding a session.</p>
              )}
              <span className="access-actions">
                <TextField
                  type="password"
                  value={m.password}
                  onChange={(ev) => updateAccessModal({ password: ev.target.value })}
                  placeholder="new password"
                  aria-label="new password"
                />
                <Button size="sm" disabled={!m.password || m.pwBusy} onClick={savePassword}>
                  {m.hasPassword ? "Change" : "Set"}
                </Button>
              </span>
              {m.pwError && <Alert intent="bad">{m.pwError}</Alert>}
            </span>
          )}
        </section>

        <section className="access-section">
          <Switch
            checked={m.oauthOn}
            onChange={onOauthSwitch}
            label="Google sign-in"
            title={
              m.oauthOn ? "google sign-in is required, click to turn it off" : "no sign-in gate, click to require google"
            }
            aria-label={m.oauthOn ? "turn google sign-in off" : "require google sign-in"}
          />
          {m.oauthOn && (
            <span className="access-section">
              <p className="muted">Visitors sign in with Google at Cloudflare's edge before reaching the app.</p>
              <RadioGroup
                name="oauth-mode"
                value={m.mode}
                onChange={(value) => {
                  updateAccessModal({ mode: value as "emails" | "domains" });
                  onOauthMode();
                }}
                options={[
                  { value: "domains", label: "Anyone at these domains" },
                  { value: "emails", label: "These people" },
                ]}
              />
              <TextArea
                label={m.mode === "emails" ? "Allowed emails" : "Allowed domains"}
                rows={4}
                value={m.list}
                onChange={(ev) => updateAccessModal({ list: ev.target.value })}
                placeholder={m.mode === "emails" ? "a@x.dev\nb@y.dev" : "corp.com\nother.dev"}
                classNames={{ input: "access-list" }}
              />
              <p className="muted access-hint">One per line. Commas work too.</p>
              <span className="row-actions">
                <Button size="sm" disabled={!m.list.trim() || m.oauthBusy} onClick={applyOauth}>
                  Apply
                </Button>
              </span>
            </span>
          )}
          {/* Outside the reveal panel: a successful turn-off whose Cloudflare
              teardown was skipped or failed sets this message and clears
              oauthOn in the same breath, so a slot gated on oauthOn would
              swallow the one warning that matters. */}
          {m.oauthError && <Alert intent="bad">{m.oauthError}</Alert>}
        </section>
      </div>

      <footer className="modal-footer">
        <Button onClick={closeAccess}>
          Done
        </Button>
      </footer>
    </Modal>
  );
}
