import { Stack, Text, Title } from '@ui/core';

export interface DocPageProps {
  title: string;
  /** One-paragraph summary rendered under the title. */
  lead: string;
  children: React.ReactNode;
}

/**
 * Shared frame for one docs page: an h1 title (sized like an h2 -- the page
 * lives inside the site chrome, not a bare document), a dimmed lead
 * paragraph, and the page's sections. Content is width-capped for reading
 * comfort; wide children (tables, code) scroll within it.
 */
export function DocPage({ title, lead, children }: DocPageProps) {
  return (
    <Stack gap="xl" maw={860}>
      <Stack gap="xs">
        <Title order={1} fz="h2">
          {title}
        </Title>
        <Text c="dimmed">{lead}</Text>
      </Stack>
      {children}
    </Stack>
  );
}

export interface DocSectionProps {
  title: string;
  /** Optional anchor id, for in-page hash links. */
  id?: string;
  children: React.ReactNode;
}

/** One titled section within a DocPage (an h2, sized down to fit the page scale). */
export function DocSection({ title, id, children }: DocSectionProps) {
  return (
    <Stack component="section" id={id} gap="md">
      <Title order={2} fz="h4">
        {title}
      </Title>
      {children}
    </Stack>
  );
}
