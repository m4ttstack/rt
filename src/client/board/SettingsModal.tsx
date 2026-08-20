import { useCallback, useEffect, useState } from "react";
import { Invadr } from "invadrs/react";
import { memberPeerState, joinRowState } from "../../view.ts";
import type { ConfigMember, BoardData } from "../types.ts";
import { CopyButton, Modal } from "@mattstack/tui-kit";
import { useRevealOnChange } from "../ui/hooks.ts";

/** Check members in/out, and (on a board that can hand out invites) put each
    teammate on a board of their own. Toggling persists the hidden flag to
    config.json; every peering affordance is conditional, so a board with no
    switchboard renders exactly the roster it always did. */
function SettingsModal({
  members,
  canInvite,
  local,
  peering,
  defaultMember,
  onToggle,
  onJoined,
  onClose,
}: {
  members: ConfigMember[];
  canInvite: boolean;
  /** Joining writes this board's own config and .env, so the row is offered
      only to whoever is at the machine -- POST /peer/join answers a bare
      forbidden through a tunnel, and an affordance that can only fail is worse
      than none. canInvite already folds locality in the same way. */
  local: boolean;
  peering: BoardData["peering"];
  defaultMember: string;
  onToggle: (username: string, hidden: boolean) => void;
  /** A join landed: pull /data.json so peering health and the row catch up. */
  onJoined: () => void;
  onClose: () => void;
}) {
  // null until GET /peer/boards answers, and it stays null if that fetch fails,
  // so memberPeerState renders nothing rather than calling a peer invitable.
  const [peered, setPeered] = useState<string[] | null>(null);
  const [issued, setIssued] = useState<{ username: string; invite: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  // Re-invite is two clicks, same shape as DraftModal's post: the first click
  // arms the button into "confirm re-invite", the second sends. Keyed on
  // username (not a bare flag) since the roster repeats this button per row.
  const [armedReinvite, setArmedReinvite] = useState<string | null>(null);

  useEffect(() => {
    if (!canInvite) return;
    let live = true;
    fetch("/peer/boards")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        const boards = (b as { boards?: { username: string }[] }).boards ?? [];
        setPeered(boards.map((x) => x.username));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canInvite]);

  // One handler behind every invite / re-invite button, including the free-text
  // one: the server decides what a repeat handle means, not the UI.
  const ask = useCallback((username: string) => {
    const name = username.trim();
    // Guard inside the handler, not just on the buttons: the free-text row's
    // Enter key reaches here directly, and a second POST would burn a second
    // one-time invite. submitJoin guards itself the same way.
    if (!name || pending) return;
    // Disarm any armed re-invite button here, not just the one that fired --
    // a stray armed button for a different row must never linger.
    setArmedReinvite(null);
    setPending(name);
    setInviteError(null);
    fetch("/peer/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: name }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) {
          // The server's words, verbatim: it knows why this failed and we don't.
          setIssued(null);
          setInviteError(text.trim() || `invite failed (${r.status})`);
          return;
        }
        setIssued({ username: name, invite: (JSON.parse(text) as { invite: string }).invite });
      })
      .catch(() => {
        setIssued(null);
        setInviteError("could not reach the board");
      })
      .finally(() => setPending(null));
  }, [pending]);

  const join = joinRowState(peering !== null, peering);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const joinExpanded = joinOpen || !join.collapsed;

  // Everything this modal reveals lands at its bottom edge, past 80vh on a
  // short window. Key each ref on the state that reveals it, not on the
  // element, so a second invite for a different handle scrolls again.
  const issuedRef = useRevealOnChange<HTMLDivElement>(issued?.invite ?? null);
  const inviteErrorRef = useRevealOnChange<HTMLParagraphElement>(inviteError);
  // Reveal the join row when the user opens it, and when peering is rejected
  // (the warning is why they're here). Not when it's merely open by default on
  // an unconfigured board: that would scroll every settings open to the bottom,
  // past the roster the modal is mostly about.
  const joinRef = useRevealOnChange<HTMLDivElement>(joinOpen || peering === "unauthorized");
  const joinErrorRef = useRevealOnChange<HTMLParagraphElement>(joinError);

  const submitJoin = useCallback(() => {
    const value = joinValue.trim();
    if (!value || joining) return;
    setJoining(true);
    setJoinError(null);
    fetch("/peer/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: value }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) {
          setJoinError(text.trim() || `join failed (${r.status})`);
          return;
        }
        setJoinValue("");
        setJoinOpen(false);
        onJoined();
      })
      .catch(() => setJoinError("could not reach the board"))
      .finally(() => setJoining(false));
  }, [joinValue, joining, onJoined]);

  return (
    <Modal title="❯ team members" ariaLabel="team settings" onClose={onClose} closeGlyph="✕">
      <p className="tui-modal-sub"># check people out to hide them from the board</p>
      <ul className="tui-modal-list">
        {members.map((m) => {
          const peerState = m.username === defaultMember || !canInvite ? "unknown" : memberPeerState(m.username, peered);
          return (
            <li key={m.username} className={m.hidden ? "tui-modal-row out" : "tui-modal-row"}>
              <label className="tui-modal-name" title={m.hidden ? "checked out -- hidden from the board" : "checked in"}>
                <input
                  type="checkbox"
                  className="tui-check-box"
                  checked={!m.hidden}
                  onChange={() => onToggle(m.username, !m.hidden)}
                />
                <Invadr id={m.username} palette="css-vars" className="tui-avatar" /> {m.name ?? m.username}
              </label>
              <span className="tui-modal-right">
                {peerState === "peered" && (
                  <>
                    <span className="tui-peered" title="on peer boards">
                      peered
                    </span>
                    <button
                      className={armedReinvite === m.username ? "tui-invite-btn copied" : "tui-invite-btn"}
                      disabled={pending !== null}
                      title={
                        armedReinvite === m.username
                          ? "their current board keeps working until they use the new invite — click again to confirm"
                          : undefined
                      }
                      onClick={() => {
                        // Minting an invite rotates nothing: the peer's board
                        // keeps working until the new invite is redeemed. First
                        // click arms (in-app confirm, no native dialog); second
                        // click sends.
                        if (armedReinvite === m.username) ask(m.username);
                        else setArmedReinvite(m.username);
                      }}
                    >
                      {armedReinvite === m.username ? "confirm re-invite" : "re-invite"}
                    </button>
                  </>
                )}
                {peerState === "invitable" && (
                  <button className="tui-invite-btn" disabled={pending !== null} onClick={() => ask(m.username)}>
                    invite
                  </button>
                )}
                <span className="tui-modal-count" title={m.count === null ? "checked out -- MR count not fetched" : undefined}>
                  {m.count ?? "—"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {canInvite && (
        <div className="tui-invite-new">
          <input
            className="tui-invite-input"
            value={handle}
            aria-label="username to invite"
            placeholder="username to invite"
            onChange={(e) => setHandle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ask(handle);
            }}
          />
          <button className="tui-invite-btn" disabled={pending !== null || !handle.trim()} onClick={() => ask(handle)}>
            invite
          </button>
        </div>
      )}

      {inviteError && (
        <p ref={inviteErrorRef} className="tui-modal-sub tui-invite-error">
          {inviteError}
        </p>
      )}

      {issued && (
        <div ref={issuedRef} className="tui-invite-row">
          <code className="tui-invite-code">{issued.invite}</code>
          <CopyButton text={issued.invite} className="tui-invite-btn" title="copy invite" label="copy invite" />
          <span className="tui-invite-note">for {issued.username} · one-time, expires in 7 days</span>
        </div>
      )}

      {local && (
        <div ref={joinRef} className="tui-join-row">
          {join.warning && <p className="tui-modal-sub tui-join-warning">{join.warning}</p>}
          {joinExpanded ? (
            <>
              <span className="tui-join-label">{join.label}</span>
              <div className="tui-invite-new">
                <input
                  className="tui-invite-input"
                  value={joinValue}
                  aria-label="paste your board invite"
                  placeholder="paste your board invite"
                  onChange={(e) => setJoinValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitJoin();
                  }}
                />
                <button className="tui-invite-btn" disabled={joining || !joinValue.trim()} onClick={submitJoin}>
                  join
                </button>
              </div>
              {joinError && (
                <p ref={joinErrorRef} className="tui-modal-sub tui-invite-error">
                  {joinError}
                </p>
              )}
            </>
          ) : (
            <button className="tui-join-toggle" onClick={() => setJoinOpen(true)}>
              {join.label}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

export { SettingsModal };
