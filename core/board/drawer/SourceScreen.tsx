// Source screen: a managed row's dev link, tucked out of the table per the
// board's dev/prod matrix. The linked checkout and its manifest command names
// are read-only facts here — the resolver owns the serve shape, so there is
// nothing to edit, only a link to point, fix, or remove.
import { useState } from "react";
import { ListGroup } from "@mattstack/tui-kit";
import type { Row } from "../logic.ts";
import type { BoardState } from "../useBoardState.ts";
import type { Nav, ScreenBuilder } from "./RootScreen.tsx";

export function sourceValue(row: Row): { text: string; bad: boolean } {
  if (row.devLink === "linked") return { text: row.devDir ?? "linked", bad: false };
  if (row.devLink === "broken") return { text: "broken", bad: true };
  return { text: "not linked", bad: false };
}

function linkFooter(row: Row): string {
  if (row.devLink === "linked") return "dev commands are read live from this checkout's mattstack.deck.json";
  if (row.devLink === "broken") return "the linked directory is missing or its manifest is invalid — relink to fix";
  return "link a source checkout to get build/deploy here and source serving in dev mode";
}

/** Inline path input for link/relink — the drawer twin of the table's
    DevLinkPrompt, kept as a component so its state survives re-renders. */
function SourceLinkInput({ row, board, done }: { row: Row; board: BoardState; done: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const workingDirectory = value.trim();
    if (!workingDirectory) return;
    setBusy(true);
    const message = await board.linkSource(row, workingDirectory);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setValue("");
    done();
  };

  return (
    <ListGroup.Input
      value={value}
      onChange={(ev) => {
        setValue(ev.target.value);
        setError(null);
      }}
      placeholder="/path/to/source"
      aria-label={`source path for ${row.name}`}
      error={error ?? undefined}
      disabled={busy}
      inputRef={(el) => el?.focus()}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") submit();
        if (ev.key === "Escape") done();
      }}
    />
  );
}

function SourceGroups({ row, board, nav }: { row: Row; board: BoardState; nav: Nav }) {
  const [linking, setLinking] = useState(false);
  const linked = row.devLink === "linked";
  return (
    <div className="drawer-groups">
      <ListGroup footer={linkFooter(row)}>
        <ListGroup.Fact label="directory" value={row.devDir ?? "—"} />
        <ListGroup.Fact label="state" value={row.devLink ?? "unknown"} />
        {(row.commands?.length ?? 0) > 0 && <ListGroup.Fact label="commands" value={row.commands!.join(" · ")} />}
      </ListGroup>
      <ListGroup>
        {linking ? (
          <SourceLinkInput row={row} board={board} done={() => setLinking(false)} />
        ) : (
          <ListGroup.Action
            label={linked ? "relink source…" : "link a source repo…"}
            onClick={() => setLinking(true)}
          />
        )}
      </ListGroup>
      {linked && (
        <div className="drawer-danger-group">
          <ListGroup footer="the app keeps running from its installed bundle; dev commands disappear until relinked">
            <ListGroup.Danger
              label="Unlink"
              onClick={() => {
                void board.unlinkSource(row);
                nav.pop();
              }}
            />
          </ListGroup>
        </div>
      )}
    </div>
  );
}

export const buildSourceScreen: ScreenBuilder = (row, nav, board) => ({
  id: `source:${row.name}`,
  title: "source",
  content: <SourceGroups row={row} board={board} nav={nav} />,
});
