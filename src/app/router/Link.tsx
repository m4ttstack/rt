import { forwardRef } from 'react';

import { navigate } from './navigation';

export interface LinkProps extends React.ComponentPropsWithoutRef<'a'> {
  href: string;
  /** Use replaceState instead of pushState for this navigation. @default false */
  replace?: boolean;
}

/**
 * The router's anchor: renders a real `<a href>` (so middle-click,
 * copy-link, and open-in-new-tab all behave normally), but intercepts plain
 * left-clicks and routes them through `navigate()` instead of a full page
 * load.
 *
 * A click is left alone (native navigation) when any of these hold:
 * - a caller-supplied onClick already called preventDefault
 * - it isn't a plain left-click (modifier key held, or a non-primary button)
 * - the anchor targets another browsing context (target other than _self)
 * - the href is an in-page hash link (native anchor scrolling should win)
 *
 * Being a plain forwardRef `<a>` wrapper is what makes it usable with
 * Mantine's polymorphic `component` prop: `<Anchor component={Link}
 * href="/docs">`, `<Button component={Link} ...>`, etc.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace = false, onClick, target, ...rest },
  ref
) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== '_self') ||
      href.startsWith('#')
    ) {
      return;
    }
    event.preventDefault();
    navigate(href, { replace });
  };

  return (
    <a ref={ref} href={href} target={target} onClick={handleClick} {...rest} />
  );
});
