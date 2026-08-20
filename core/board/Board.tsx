import { subline } from "./logic.ts";

export function Board() {
  return (
    <main className="board" data-board-ready>
      <header className="board-header">
        <h1>Deck</h1>
      </header>
      <p className="board-subline">{subline(null)}</p>
    </main>
  );
}
