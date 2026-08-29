import { Title } from '@mantine/core';

/**
 * The page title as it reads on a single header ROW -- sized to sit beside
 * tabs or actions rather than to head a roomy title band. Still a `Title`
 * order 2 (the page's h2 for assistive tech), just scaled down and set to
 * one line. Shared by `TabBar` (its `title`) and a `compactHeader` `Header`
 * so a page that swaps between the two keeps one title treatment.
 */
export const RowTitle = ({ children }: { children: React.ReactNode }) => (
  <Title order={2} size="h5" fw={700} style={{ whiteSpace: 'nowrap' }}>
    {children}
  </Title>
);
