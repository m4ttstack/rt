// Access screens, per drawer-states-atlas.html "3 · Access". Root shows the
// password/sign-in hints and the sign-in toggle; password and who push on
// top of it. Mirrors AccessModal's old semantics exactly (see useBoardState):
// turning sign-in ON is a local intent only -- nothing reaches Cloudflare
// until who's save applies mode+entries together; turning it OFF still calls
// the API immediately, and a teardown failure renders here even after the
// toggle itself reads off (oauthError is not gated on oauthOn).
import { Alert, ListGroup, type DrawerScreen } from "@mattstack/tui-kit";
import type { Row } from "../logic.ts";
import type { AccessModalState } from "../useBoardState.ts";
import type { ScreenBuilder } from "./RootScreen.tsx";

function whoValue(m: AccessModalState): string {
  const n = m.entries.length;
  if (m.mode === "domains") return `${n} domain${n === 1 ? "" : "s"}`;
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function passwordFooter(): string {
  return "visitors enter this password before the proxy lets them through";
}

function signInFooter(): string {
  return "sign-in happens at cloudflare's edge, before traffic reaches the app";
}

// Shown in place of the two gate-specific footers above once neither gate is
// on -- the atlas's own "everything off" root variant carries this single
// summary line instead of two absent ones.
function openFooter(row: Row): string {
  return `${row.name} is open — anyone who can reach the tunnel gets in`;
}

function ModeRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect(): void }) {
  return (
    <li className="drawer-mode-item">
      <button type="button" role="radio" aria-checked={selected} className="drawer-mode-row" onClick={onSelect}>
        {selected && (
          <span className="drawer-mode-check" aria-hidden="true">
            {"✓ "}
          </span>
        )}
        {label}
      </button>
    </li>
  );
}

function EntryRow({ entry, onRemove }: { entry: string; onRemove(): void }) {
  return (
    <li className="drawer-entry-item">
      <button type="button" className="drawer-entry-row" onClick={onRemove} aria-label={`remove ${entry}`}>
        <span>{entry}</span>
        <span className="drawer-entry-remove" aria-hidden="true">
          {"✕"}
        </span>
      </button>
    </li>
  );
}

export const buildAccessRoot: ScreenBuilder = (row, nav, board): DrawerScreen => {
  const m = board.accessModal;
  const nothingSet = !row.hasPassword && !(m?.oauthOn ?? false);
  return {
    id: `access:${row.name}`,
    title: "access",
    content: (
      <div className="drawer-groups">
        <ListGroup footer={row.hasPassword ? passwordFooter() : undefined}>
          <ListGroup.Nav
            label="password"
            value={row.hasPassword ? "set" : "not set"}
            onClick={() => nav.push(buildAccessPassword)}
          />
        </ListGroup>
        {m && (
          <ListGroup footer={m.oauthOn ? signInFooter() : nothingSet ? openFooter(row) : undefined}>
            <ListGroup.Toggle
              label="google sign-in"
              checked={m.oauthOn}
              onChange={() => board.onOauthSwitch()}
              aria-label={m.oauthOn ? "turn google sign-in off" : "require google sign-in"}
            />
            {m.oauthOn && (
              <ListGroup.Nav
                label="who"
                value={whoValue(m)}
                onClick={() =>
                  // onLeave, not a clear-on-entry here too: whichever way who
                  // is left (kit back chevron, ✕, or a row switch) an apply
                  // error it set must not survive onto root -- root's OWN
                  // oauthError (the toggle-off teardown-failure case) is a
                  // different write path entirely and is untouched by this.
                  nav.push(buildAccessWho, () => board.updateAccessModal({ oauthError: null }))
                }
              />
            )}
          </ListGroup>
        )}
        {m?.oauthError && <Alert intent="bad">{m.oauthError}</Alert>}
      </div>
    ),
  };
};

export const buildAccessPassword: ScreenBuilder = (row, nav, board): DrawerScreen => {
  const m = board.accessModal;
  const value = m?.password ?? "";
  const busy = m?.pwBusy ?? false;
  const save = async () => {
    if (await board.savePassword()) nav.pop();
  };
  return {
    id: `access-password:${row.name}`,
    title: "password",
    navAction: { label: "save", onAction: save, disabled: value.trim() === "" || busy },
    content: (
      <div className="drawer-groups">
        <ListGroup footer="replaces the current password immediately for new visitors">
          <ListGroup.Input
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(ev) => board.updateAccessModal({ password: ev.target.value })}
            placeholder="new password"
            aria-label="new password"
            inputRef={(el) => el?.focus()}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && value.trim() !== "") save();
            }}
          />
        </ListGroup>
        {m?.pwError && <Alert intent="bad">{m.pwError}</Alert>}
        {row.hasPassword && (
          <ListGroup>
            <ListGroup.Danger label="remove password" onClick={() => board.removePassword()} disabled={busy} />
          </ListGroup>
        )}
      </div>
    ),
  };
};

export const buildAccessWho: ScreenBuilder = (row, nav, board): DrawerScreen => {
  const m = board.accessModal;
  const entries = m?.entries ?? [];
  const mode = m?.mode ?? "emails";
  const draft = m?.entryDraft ?? "";
  const busy = m?.oauthBusy ?? false;

  const save = async () => {
    if (await board.applyOauth()) nav.pop();
  };
  const commitDraft = () => board.addAccessEntry(draft);
  const selectMode = (next: "emails" | "domains") => {
    board.updateAccessModal({ mode: next });
    board.onOauthMode();
  };

  return {
    id: `access-who:${row.name}`,
    title: "who",
    navAction: { label: "save", onAction: save, disabled: entries.length === 0 || busy },
    content: (
      <div className="drawer-groups">
        <div role="radiogroup" aria-label="who can sign in">
          <ListGroup>
            <ModeRow label="anyone at these domains" selected={mode === "domains"} onSelect={() => selectMode("domains")} />
            <ModeRow label="these people" selected={mode === "emails"} onSelect={() => selectMode("emails")} />
          </ListGroup>
        </div>
        <ListGroup footer="changes apply at cloudflare when you leave this screen">
          {entries.map((entry, i) => (
            <EntryRow key={entry} entry={entry} onRemove={() => board.removeAccessEntry(i)} />
          ))}
          <ListGroup.Input
            value={draft}
            onChange={(ev) => board.updateAccessModal({ entryDraft: ev.target.value })}
            placeholder={mode === "emails" ? "+ add email…" : "+ add domain…"}
            aria-label={mode === "emails" ? "add email" : "add domain"}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                commitDraft();
              }
            }}
            onBlur={commitDraft}
          />
        </ListGroup>
        {m?.oauthError && <Alert intent="bad">{m.oauthError}</Alert>}
      </div>
    ),
  };
};
