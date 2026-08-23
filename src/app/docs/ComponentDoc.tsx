import { Paper, Text } from '@ui/core';
import { CodeBlock } from '../components/CodeBlock';
import { DocPage, DocSection } from './DocPage';
import { OptionsTable, type OptionRow } from './OptionsTable';

/** The bordered surface a component page's live demo sits on. Exported for
 * pages that need to compose their own demo section layout while keeping
 * the shared frame look. */
export function DemoFrame({ children }: { children: React.ReactNode }) {
  return (
    <Paper withBorder p="md">
      {children}
    </Paper>
  );
}

export interface ComponentDocPropsTable {
  /** Section title -- 'Props' for a single-component page, or a named table
   * per member ('RailEntry props') on a family page. */
  title: string;
  /** Optional framing sentence above the table. */
  intro?: React.ReactNode;
  /** Rows transcribed from the component source under src/ui/** -- keep
   * them in sync when the kit surface changes. */
  rows: OptionRow[];
}

export interface ComponentDocProps {
  /** The component name, rendered as the page h1. */
  title: string;
  /** One-line description under the title. */
  lead: string;
  /** The live demo, rendered inside a `DemoFrame` unless `bareDemo`. */
  demo: React.ReactNode;
  /** Optional sentence above the demo. */
  demoIntro?: React.ReactNode;
  /** Renders `demo` as given, for demos that bring their own frame
   * (e.g. a fixed-height shell box). @default false */
  bareDemo?: boolean;
  /** Usage snippet, rendered as a tsx `CodeBlock`. */
  usage: string;
  /** Reserved height for the lazily-loaded usage block. */
  usageMinHeight: number;
  propsTables: ComponentDocPropsTable[];
  /** Optional extra sections (when-to-use, caveats), rendered last. */
  children?: React.ReactNode;
}

/**
 * Shared frame for one component reference page: a live interactive demo,
 * a usage snippet, one or more props tables, and optional trailing note
 * sections -- the same `DocPage`/`DocSection` conventions as the guide
 * pages, kept tight (a reference, not an essay).
 */
export function ComponentDoc({
  title,
  lead,
  demo,
  demoIntro,
  bareDemo = false,
  usage,
  usageMinHeight,
  propsTables,
  children,
}: ComponentDocProps) {
  return (
    <DocPage title={title} lead={lead}>
      <DocSection title="Live demo">
        {demoIntro != null && <Text size="sm">{demoIntro}</Text>}
        {bareDemo ? demo : <DemoFrame>{demo}</DemoFrame>}
      </DocSection>
      <DocSection title="Usage">
        <CodeBlock code={usage} language="tsx" minHeight={usageMinHeight} />
      </DocSection>
      {propsTables.map(({ title: tableTitle, intro, rows }) => (
        <DocSection key={tableTitle} title={tableTitle}>
          {intro != null && <Text size="sm">{intro}</Text>}
          <OptionsTable rows={rows} />
        </DocSection>
      ))}
      {children}
    </DocPage>
  );
}
