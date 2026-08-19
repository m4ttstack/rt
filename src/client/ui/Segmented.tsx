import { ICONS } from "./Icon.tsx";

/** A labelled segmented control (text labels, unlike the icon-only Segmented). */
function LabeledSeg<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="tui-seg tui-seg-text" role="group" aria-label={legend}>
      {options.map((o) => (
        <button key={o} className={o === value ? "active" : ""} onClick={() => onChange(o)}>
          {labels[o]}
        </button>
      ))}
    </span>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="tui-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          className={o === value ? "active" : ""}
          onClick={() => onChange(o)}
          title={o}
          aria-label={o}
        >
          {ICONS[o] ?? o}
        </button>
      ))}
    </span>
  );
}

export { LabeledSeg, Segmented };
