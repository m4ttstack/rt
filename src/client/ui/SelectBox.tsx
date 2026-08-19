/** Row/card selection checkbox. A real button so the existing onRowClick guard
    (which ignores clicks on `a, button`) already skips it -- stopPropagation is
    belt-and-braces in case that guard changes. */
function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "deselect this MR" : "select this MR"}
      className={checked ? "tui-selectbox checked" : "tui-selectbox"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "▣" : "☐"}
    </button>
  );
}

export { SelectBox };
