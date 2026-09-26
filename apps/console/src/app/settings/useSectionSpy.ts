import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

// A section counts as the one being read once its top is this far into the
// frame, so a heading just scrolled into view does not take the mark yet.
const READ_LINE = 80;

function sectionTop(id: string): number | undefined {
  return document.getElementById(`settings-${id}`)?.getBoundingClientRect().top;
}

function inView(frame: HTMLElement, ids: string[]): string {
  const scrollable = frame.scrollHeight > frame.clientHeight;
  // The last sections may be too short to ever reach the read line.
  if (
    scrollable &&
    frame.scrollTop > 0 &&
    frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 1
  )
    return ids[ids.length - 1]!;
  const line = frame.getBoundingClientRect().top + READ_LINE;
  let current = ids[0]!;
  for (const id of ids) {
    const top = sectionTop(id);
    if (top !== undefined && top <= line) current = id;
  }
  return current;
}

/** The group whose section is in view inside the content frame, and a jump
    that scrolls to a group and keeps it marked until the reader scrolls on,
    even when the frame cannot bring a short last group to its top. */
export function useSectionSpy(
  frame: RefObject<HTMLElement | null>,
  ids: string[],
  initial: string
): [active: string, jump: (id: string) => void] {
  const [active, setActive] = useState(initial);
  const pinned = useRef<{ id: string; at?: number } | null>(null);
  const key = ids.join(' ');

  useEffect(() => {
    const el = frame.current;
    const shown = key === '' ? [] : key.split(' ');
    if (!el || shown.length === 0) return;
    const update = () => {
      const pin = pinned.current;
      // A scroll that fires inside scrollIntoView has no resting position yet.
      if (
        pin &&
        shown.includes(pin.id) &&
        (pin.at === undefined || pin.at === el.scrollTop)
      ) {
        setActive(pin.id);
        return;
      }
      pinned.current = null;
      setActive(inView(el, shown));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [frame, key]);

  const jump = useCallback(
    (id: string) => {
      if (!key.split(' ').includes(id)) return;
      const pin: { id: string; at?: number } = { id };
      pinned.current = pin;
      document
        .getElementById(`settings-${id}`)
        ?.scrollIntoView({ block: 'start' });
      pin.at = frame.current?.scrollTop;
      setActive(id);
    },
    [frame, key]
  );

  return [active, jump];
}
