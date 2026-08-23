/** The docs section's information architecture: every docs page's slug,
 * label, and sidebar grouping, in sidebar order. The '' slug is the docs
 * landing page itself (/docs, Getting started); component reference pages
 * live under the 'components/' prefix (/docs/components/<name>). */
export const DOCS_SLUGS = [
  '',
  'theming',
  'hooks',
  'modals',
  'notifications',
  'forms',
  'app-chrome',
  'import-walls',
  'scaffolding',
  'components',
  'components/site-shell',
  'components/rail-shell',
  'components/page-shell',
  'components/content-container',
  'components/slide-in-sidebar',
  'components/notch',
  'components/gradient-border',
  'components/animated-border-box',
  'components/selectable-list',
  'components/acceptable-list',
  'components/searchable-menu',
  'components/hybrid-menu',
  'components/text-input',
  'components/range-picker',
  'components/collapsible-alert-card',
  'components/generic-error',
  'components/lazy-loader',
  'components/copy-buttons',
  'components/icon-tooltip',
  'components/hover-wrappers',
  'components/table',
  'components/virtual-list',
  'components/virtual-table',
  'components/code-highlight',
  'components/codemirror',
  'icons',
  'lazy-loading',
  'components/form-container',
  'components/use-modal-form',
  'components/timed-ring-progress',
  'components/theme-override-wrapper',
  'components/theme-island',
  'hooks/use-scheme-colors',
  'hooks/use-color-scheme',
  'hooks/use-ui-state',
  'hooks/use-storage',
  'hooks/use-is-mobile',
  'hooks/use-has-overflow-x',
  'hooks/use-hoverable-text-style',
] as const;

export type DocsSlug = (typeof DOCS_SLUGS)[number];

export function isDocsSlug(value: string): value is DocsSlug {
  return (DOCS_SLUGS as readonly string[]).includes(value);
}

export function docsPath(slug: DocsSlug): string {
  return slug === '' ? '/docs' : `/docs/${slug}`;
}

export interface DocsNavItem {
  slug: DocsSlug;
  label: string;
  /** One-liner shown on the components index; component entries only. */
  description?: string;
}

export interface DocsNavGroup {
  label: string;
  items: DocsNavItem[];
}

/**
 * The component reference groups, one sidebar group per category the way
 * standard UI library docs are organized. Also drives the /docs/components
 * index page. Categories gain entries as their pages land -- a page must
 * exist (slug in `DOCS_SLUGS`, page in `DOCS_PAGES`) before it is listed
 * here.
 */
export const COMPONENT_NAV_GROUPS: DocsNavGroup[] = [
  {
    label: 'Components',
    items: [{ slug: 'components', label: 'Overview' }],
  },
  {
    label: 'App chrome',
    items: [
      {
        slug: 'components/site-shell',
        label: 'SiteShell',
        description:
          'Fixed kit-styled header above body-scrolled content, with an optional fixed sidebar -- the site-level chrome wrapper over AppShell.',
      },
      {
        slug: 'components/rail-shell',
        label: 'RailShell',
        description:
          'The mini icon rail app chrome: RailShell + Rail + RailEntry, wired by useRailState.',
      },
      {
        slug: 'components/page-shell',
        label: 'PageShell',
        description:
          'Compound page layout: collapsible persisted sidebar, header row, tab row, and scroll-managed content with a topNotch banner slot.',
      },
    ],
  },
  {
    label: 'Layout',
    items: [
      {
        slug: 'components/content-container',
        label: 'ContentContainer',
        description:
          'Fluid container capped at MAX_CONTENT_WIDTH (1280px), centered; paints no background of its own.',
      },
      {
        slug: 'components/slide-in-sidebar',
        label: 'SlideInSidebar',
        description:
          'An in-flow collapsible rail that animates its width to 0 instead of overlaying the page; content stays mounted while closed.',
      },
      {
        slug: 'components/notch',
        label: 'Notch',
        description:
          "Dismissible banner for PageShell's topNotch slot, docked under the header edge.",
      },
      {
        slug: 'components/gradient-border',
        label: 'GradientBorder',
        description: 'Thin three-color gradient border around its children.',
      },
      {
        slug: 'components/animated-border-box',
        label: 'AnimatedBorderBox',
        description:
          'Paper with a slowly rotating conic-gradient border (CSS-only).',
      },
    ],
  },
  {
    label: 'Lists & menus',
    items: [
      {
        slug: 'components/selectable-list',
        label: 'SelectableList',
        description:
          'Searchable, checkbox-selectable list with select-all header and virtualized rows; selection is uncontrolled by default or controlled via selectedKeys/onSelectionChange.',
      },
      {
        slug: 'components/acceptable-list',
        label: 'AcceptableList',
        description:
          'Accept/decline rows with per-row in-flight spinners and an Accept All action.',
      },
      {
        slug: 'components/searchable-menu',
        label: 'SearchableMenu',
        description:
          'Dropdown menu with a multi-field, highlighted search filter over a virtualized, pinnable result list.',
      },
      {
        slug: 'components/hybrid-menu',
        label: 'HybridMenu',
        description:
          'Part Select (checked options), part action menu below a divider.',
      },
    ],
  },
  {
    label: 'Inputs & pickers',
    items: [
      {
        slug: 'components/text-input',
        label: 'TextInput',
        description:
          'The TextInput shadow: Mantine\'s input with autoComplete="off" as the kit default, opt back in per field with a specific token.',
      },
      {
        slug: 'components/range-picker',
        label: 'RangePicker',
        description:
          'Date-range picker with preset ranges and a Date-based value API, built on @mantine/dates.',
      },
    ],
  },
  {
    label: 'Feedback & overlays',
    items: [
      {
        slug: 'components/collapsible-alert-card',
        label: 'CollapsibleAlertCard',
        description:
          'Alert-tinted card with a chevron-toggled collapsible body, accented by any Mantine color.',
      },
      {
        slug: 'components/generic-error',
        label: 'GenericError',
        description:
          'Standard "this section failed to load" state: illustration, optional title, message, optional action button.',
      },
      {
        slug: 'components/lazy-loader',
        label: 'LazyLoader',
        description:
          'Suspense boundary with a themed fallback: centered loader (default), overlay, contained, skeleton, or custom.',
      },
      {
        slug: 'components/copy-buttons',
        label: 'Copy buttons',
        description:
          'CopyActionIcon (icon-only) and the labeled CopyButton shadow, both with self-reverting checkmark feedback.',
      },
      {
        slug: 'components/icon-tooltip',
        label: 'IconTooltip',
        description:
          'Small inline info icon carrying a tooltip label, keyboard-focusable.',
      },
      {
        slug: 'components/hover-wrappers',
        label: 'Hover wrappers',
        description:
          'HoverBox / HoverGroup / HoverStack: layout wrappers handing their hovered state to a render prop.',
      },
    ],
  },
  {
    label: 'Data & code',
    items: [
      {
        slug: 'components/table',
        label: 'Table',
        description:
          'The Table shadow: Mantine Table on a Paper surface with a bg.level4 header accent.',
      },
      {
        slug: 'components/virtual-list',
        label: 'VirtualList',
        description:
          'Windowed rows via @tanstack/react-virtual -- only visible rows mount.',
      },
      {
        slug: 'components/virtual-table',
        label: 'VirtualTable',
        description:
          'Windowed table: a declarative default with typed column definitions and a sticky header, plus an inversion-of-control shell + header pair for caller-owned virtualizers.',
      },
      {
        slug: 'components/code-highlight',
        label: 'CodeHighlight',
        description:
          'Lazily-loaded @mantine/code-highlight with the full Mantine prop surface.',
      },
      {
        slug: 'components/codemirror',
        label: 'CodeMirror',
        description:
          'Lazily-loaded CodeMirror 6 editor with a value/onChange surface.',
      },
      {
        slug: 'icons',
        label: 'Icons',
        description:
          'Closed, typed registry of lucide icons (name -> component), the brand-icon slot, and AnimatedChevron.',
      },
      {
        slug: 'lazy-loading',
        label: 'Lazy loading',
        description:
          "How @ui/lazy keeps the kit's heaviest dependencies out of the entry bundle, plus loadOnce.",
      },
    ],
  },
  {
    label: 'Forms & facades',
    items: [
      {
        slug: 'components/form-container',
        label: 'FormContainer',
        description:
          'Layout + submit wiring for every kit form: Paper surface (or plain mode), loading overlay, error summary, submit row.',
      },
      {
        slug: 'components/use-modal-form',
        label: 'useModalForm',
        description:
          'A zod-validated form living entirely inside a modal the hook owns, with useModalFormSubmit underneath.',
      },
      {
        slug: 'components/timed-ring-progress',
        label: 'TimedRingProgress',
        description:
          'Countdown ring calling onComplete exactly once at zero -- the countdown-notification icon.',
      },
    ],
  },
  {
    label: 'Design system',
    items: [
      {
        slug: 'components/theme-override-wrapper',
        label: 'ThemeOverrideWrapper',
        description:
          'Scopes a partial theme override to one subtree, merged onto the ambient MantineProvider theme.',
      },
      {
        slug: 'components/theme-island',
        label: 'ThemeIsland',
        description:
          "Renders one subtree in a different theme entirely, scoped so nothing leaks -- pass baseTheme to get the kit's own look back inside a branded app.",
      },
    ],
  },
  {
    // The kit's own hooks (useRailState and usePageShellContext are
    // documented with their components on the RailShell/PageShell pages;
    // the components index notes that).
    label: 'Hooks',
    items: [
      {
        slug: 'hooks/use-scheme-colors',
        label: 'useSchemeColors',
        description:
          'The bg.level1..4 surface tokens plus text.normal/muted/dimmed, as scheme-aware CSS var references.',
      },
      {
        slug: 'hooks/use-color-scheme',
        label: 'useColorScheme',
        description:
          'Persisted scheme preference with a synchronous first read, plus useLightDark and useStoredColorScheme.',
      },
      {
        slug: 'hooks/use-ui-state',
        label: 'useUIState',
        description:
          '[state, setState, deferredValue] for lag-tolerant expensive renders; useStoredUIState persists the same tuple.',
      },
      {
        slug: 'hooks/use-storage',
        label: 'Storage hooks',
        description:
          "The useLocalStorage/useSessionStorage shadows: getInitialValueInEffect false, so there's no first-paint flash.",
      },
      {
        slug: 'hooks/use-is-mobile',
        label: 'useIsMobile',
        description:
          "True once the viewport is measured and at/below the theme's sm breakpoint.",
      },
      {
        slug: 'hooks/use-has-overflow-x',
        label: 'useHasOverflowX',
        description:
          '{ ref, hasOverflow }: tracks horizontal overflow via a ResizeObserver.',
      },
      {
        slug: 'hooks/use-hoverable-text-style',
        label: 'useHoverableTextStyle',
        description:
          'Dotted-underline style object for text that should read as hoverable/clickable.',
      },
    ],
  },
];

export const DOCS_NAV_GROUPS: DocsNavGroup[] = [
  {
    label: 'Overview',
    items: [{ slug: '', label: 'Getting started' }],
  },
  {
    // What the kit gives you leads; how the conventions are enforced
    // (import walls) and how a new app starts (scaffolding) close the
    // group.
    label: 'Guides',
    items: [
      { slug: 'theming', label: 'Theming & backgrounds' },
      { slug: 'hooks', label: 'Hooks' },
      { slug: 'modals', label: 'Modals' },
      { slug: 'notifications', label: 'Notifications' },
      { slug: 'forms', label: 'Forms' },
      { slug: 'app-chrome', label: 'App chrome' },
      { slug: 'import-walls', label: 'Import walls' },
      { slug: 'scaffolding', label: 'Scaffolding' },
    ],
  },
  ...COMPONENT_NAV_GROUPS,
];

/** Flat sidebar order, for prev/next footer links on each docs page. */
export const DOCS_NAV_ITEMS: DocsNavItem[] = DOCS_NAV_GROUPS.flatMap(
  group => group.items
);
