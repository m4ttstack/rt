import { ListGroup, Switch } from "@mattstack/tui-kit";
import { useOptimistic, useTransition } from "react";

/** Optimistic boolean for a Switch backed by a server mutation: the shown
    value flips the moment the user clicks, and the canonical value takes
    over when the action settles. `mutate` must end by refreshing board
    state (every useBoardState mutation does), so the canonical value is
    already correct at settle time and the hand-off is invisible; a failed
    mutation leaves canonical state unchanged and the switch snaps back. */
export function useOptimisticToggle(actual: boolean, mutate: () => Promise<void>): [boolean, () => void] {
  const [shown, setShown] = useOptimistic(actual);
  const [, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      setShown(!actual);
      await mutate();
    });
  return [shown, toggle];
}

/* Drawer screens are built by plain ScreenBuilder functions, which cannot
   call hooks — these two wrappers are the hook's only legal home there and
   keep the table cell on the same mechanism. */

export function OptimisticSwitch({
  checked,
  mutate,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  mutate: () => Promise<void>;
  "aria-label": string;
}) {
  const [shown, toggle] = useOptimisticToggle(checked, mutate);
  return <Switch checked={shown} onChange={toggle} aria-label={ariaLabel} />;
}

export function OptimisticToggleRow({
  label,
  checked,
  mutate,
  "aria-label": ariaLabel,
}: {
  label: string;
  checked: boolean;
  mutate: () => Promise<void>;
  "aria-label": string;
}) {
  const [shown, toggle] = useOptimisticToggle(checked, mutate);
  return <ListGroup.Toggle label={label} checked={shown} onChange={toggle} aria-label={ariaLabel} />;
}
