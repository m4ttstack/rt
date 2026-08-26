import { Tooltip } from "@mattstack/tui-kit";

/** An info glyph that reveals helper text on hover or focus, so a dense form
    can keep its explanations without printing them under every row. The
    button carries the text as its aria-label because the kit's tooltip card
    is hidden from assistive tech by design. tui-kit candidate: a Tooltip
    composition, not board logic. */
export function InfoTip({ text, about }: { text: string; about: string }) {
  return (
    <Tooltip tip={text} classNames={{ card: "tui-info-card" }}>
      <button type="button" className="tui-info" aria-label={`about ${about}: ${text}`}>
        i
      </button>
    </Tooltip>
  );
}
