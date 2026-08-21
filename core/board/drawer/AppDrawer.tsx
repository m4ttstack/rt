// Owns the drawer's screen stack and the keyboard/focus contract layered on
// top of the kit Drawer: esc/✕/overlay-close and the nav-bar back button are
// the kit's own job (SideDrawer wires escape internally); this module adds
// row retargeting (↑/↓), the row-vanished guard, and focus restore to the
// currently-open row rather than whichever row was clicked to open it.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Drawer, type DrawerScreen } from "@mattstack/tui-kit";
import type { Row, StatusData } from "../logic.ts";
import type { BoardState } from "../useBoardState.ts";
import { buildAppRoot, buildServiceRoot, buildTunnelRoot, type Nav, type ScreenBuilder } from "./RootScreen.tsx";

function rootScreenFor(row: Row, nav: Nav, board: BoardState, data: StatusData): DrawerScreen {
  const restarting = board.isRestarting(row);
  if (row.isTunnel) return buildTunnelRoot(row, nav, board, data, restarting);
  if (row.port == null) return buildServiceRoot(row, nav, board, restarting);
  return buildAppRoot(row, nav, board, data, restarting);
}

export interface AppDrawerProps {
  /** Every row across every section + tunnels, in display order -- the list
      ↑/↓ walks. */
  rows: Row[];
  data: StatusData;
  board: BoardState;
  openRowName: string | null;
  onOpenRowNameChange: (name: string | null) => void;
  chevronRefs: Map<string, HTMLButtonElement>;
  /** Focus target when the open row vanishes out from under the drawer (a
      poll can remove a row while its drawer is open) -- a stable element,
      never left to fall back to body. */
  fallbackFocusRef: RefObject<HTMLElement | null>;
}

export function AppDrawer({
  rows,
  data,
  board,
  openRowName,
  onOpenRowNameChange,
  chevronRefs,
  fallbackFocusRef,
}: AppDrawerProps) {
  // Builders, not built DrawerScreen values: AppDrawer calls each one fresh
  // every render (see `stack` below) so a mutation a pushed screen triggers
  // -- which flows back through fresh row/data/board -- shows up on that
  // same screen instead of staying frozen at whatever it looked like when
  // it was pushed. `onLeave` is optional per-frame cleanup, run once when
  // the frame is removed (see the `Nav` doc comment).
  const [pushed, setPushed] = useState<Array<{ build: ScreenBuilder; onLeave?: () => void }>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // onLeave callbacks a row switch discarded, drained by the effect below.
  // Firing them right here (during the render-time reset two blocks down)
  // would call a board setter -- e.g. clearing access's oauthError -- while
  // AppDrawer, not Board, is mid-render, which React disallows; queuing them
  // for the post-commit effect is the same "defer the foreign update" move
  // `cancelEdit`/`closeAccess` already make via their own effects below.
  const pendingLeaveRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (pendingLeaveRef.current.length === 0) return;
    const fns = pendingLeaveRef.current;
    pendingLeaveRef.current = [];
    fns.forEach((fn) => fn());
  });

  // A row switch (arrow keys, or clicking a different row while one is
  // already open) always lands on that row's root, per the interaction
  // contract -- never resumes wherever the previous row's stack was. Cleared
  // synchronously DURING render (React's "adjust state while rendering"
  // pattern), not in a useEffect: an effect runs after paint, which would
  // let one frame commit with the new row's root underneath the OLD row's
  // pushed screen (stack's top is `pushed`'s last entry, not the root) --
  // briefly showing e.g. "dev port" over the row that was just switched to.
  const seenRowNameRef = useRef(openRowName);
  if (seenRowNameRef.current !== openRowName) {
    seenRowNameRef.current = openRowName;
    for (const frame of pushed) {
      if (frame.onLeave) pendingLeaveRef.current.push(frame.onLeave);
    }
    setPushed([]);
  }

  const row = openRowName != null ? (rows.find((r) => r.name === openRowName) ?? null) : null;

  // A row that closes or switches away mid-edit (dev port's setting screen)
  // must not leave `board.editing` set: refresh() skips every poll while it
  // is, which would otherwise freeze the whole board's status forever behind
  // a screen nobody can see anymore.
  useEffect(() => {
    return () => board.cancelEdit();
  }, [openRowName, board.cancelEdit]);

  // Same idea for the access working buffer: it's reseeded fresh every time
  // the access nav row is clicked (openAccess), so this is just hygiene
  // against a stale password/entries buffer surviving a row switch.
  useEffect(() => {
    return () => board.closeAccess();
  }, [openRowName, board.closeAccess]);

  const nav: Nav = {
    push: (build, onLeave) => setPushed((prev) => [...prev, { build, onLeave }]),
    pop: () =>
      setPushed((prev) => {
        if (prev.length === 0) return prev;
        prev[prev.length - 1]!.onLeave?.();
        return prev.slice(0, -1);
      }),
    // Runs every remaining frame's onLeave itself, then empties `pushed`
    // eagerly (not left to the row-switch reset above, which runs on the
    // NEXT render once `openRowName` has changed) -- otherwise that reset
    // would find these same frames still in `pushed` and queue their
    // onLeave a second time.
    close: () => {
      pushed.forEach((frame) => frame.onLeave?.());
      setPushed([]);
      onOpenRowNameChange(null);
    },
  };

  // Read after commit, not during render: a row that just mounted this same
  // render registers its chevron via ref callback during commit, so the map
  // is only complete once this effect runs.
  useEffect(() => {
    returnFocusRef.current = openRowName != null ? (chevronRefs.get(openRowName) ?? null) : null;
  }, [openRowName, chevronRefs]);

  // The vanished-row guard: a poll can drop the open row (removed app,
  // stopped stray) out from under the drawer. Drawer's own returnFocusRef
  // cleanup would silently no-op on the now-detached chevron, so this closes
  // explicitly and moves focus itself rather than trusting that cleanup.
  useEffect(() => {
    if (openRowName == null) return;
    if (rows.some((r) => r.name === openRowName)) return;
    onOpenRowNameChange(null);
    // Deferred a frame so it runs after Drawer's own close-cleanup attempt
    // (which touches a stale ref and does nothing) rather than racing it.
    requestAnimationFrame(() => fallbackFocusRef.current?.focus());
  }, [rows, openRowName, onOpenRowNameChange, fallbackFocusRef]);

  useEffect(() => {
    if (row == null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea)$/i.test(target.tagName)) return;
      const idx = rows.findIndex((r) => r.name === openRowName);
      if (idx === -1) return;
      const nextIdx = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= rows.length) return;
      e.preventDefault();
      onOpenRowNameChange(rows[nextIdx]!.name);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, rows, openRowName, onOpenRowNameChange]);

  const stack: DrawerScreen[] = row
    ? [rootScreenFor(row, nav, board, data), ...pushed.map((frame) => frame.build(row, nav, board, data))]
    : [];

  return (
    <Drawer
      open={row != null}
      stack={stack}
      onBack={nav.pop}
      onClose={nav.close}
      ariaLabel={row ? `${row.name} details` : "row details"}
      returnFocusRef={returnFocusRef}
    />
  );
}
