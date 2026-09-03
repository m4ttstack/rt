import { type Column, deltaIsGood, formatValue } from "../columns";

/** A nonzero trend delta: colored direction arrow + absolute value. */
export function DeltaBadge({ delta, col, className }: { delta: number; col: Column; className?: string }) {
  const good = deltaIsGood(delta, col.better);
  return (
    <span className={`${good ? "text-success" : "text-destructive"}${className ? ` ${className}` : ""}`}>
      {delta > 0 ? "▲" : "▼"} {formatValue(Math.abs(delta), col)}
    </span>
  );
}
