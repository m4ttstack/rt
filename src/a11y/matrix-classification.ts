/**
 * Pure classification data for the contrast-matrix guard (test/matrix-guard.test.ts,
 * node tier). Mirrors the shape of soribashi's packages/ui/src/a11y/matrix-classification.ts,
 * adapted to this kit's simpler two-source-of-colour reality: every recipe either
 * resolves colour through the theme's shared intent resolver (Button), carries its
 * own recipe-local intent-to-tone map already proven by that recipe's own visual
 * baselines (Badge/Alert/StatusDot/Chip — see each recipe's own test file for why
 * it bypasses the shared resolver), or paints fixed semantic-token pairs with no
 * intent axis at all (everything else).
 */

/**
 * `'covered'`: the recipe has a real rendered contrast grid (Button.matrix.test.tsx).
 * `{ toneMapCoveredBy }`: the recipe resolves its own intent -> colour mapping
 * (not through the shared resolver Button.matrix.test.tsx exercises), and a
 * named visual-baseline test file already pins its rendered appearance across
 * every intent x scheme it declares. `{ exempt }`: the recipe carries no intent
 * axis — it paints fixed semantic-token pairs (--fg/--muted/--panel/--accent/...)
 * that do not vary by intent, so there is no grid to render.
 */
export type MatrixClassification = "covered" | { toneMapCoveredBy: string } | { exempt: string };

/** EVERY manifest recipe (buildManifest().recipes[].name) must appear here. */
export const MATRIX_CLASSIFICATION: Record<string, MatrixClassification> = {
  Alert: { toneMapCoveredBy: "src/recipes/Alert/Alert.visual.test.tsx" },
  Badge: { toneMapCoveredBy: "src/recipes/Badge/Badge.visual.test.tsx" },
  Button: "covered",
  Chip: { toneMapCoveredBy: "src/recipes/Chip/Chip.visual.test.tsx" },
  ConfirmDialog: {
    exempt:
      "structural: own body copy is fixed --fg; its confirm/cancel actions are Button instances, so Button.matrix.test.tsx covers their colour",
  },
  ContextMenu: {
    exempt: "structural chrome: fixed --card/--fg/--muted/--surface-wash-accent-16 pairs, no intent axis",
  },
  CopyButton: {
    exempt:
      "structural chrome: fixed --panel/--muted/--fg/--green pairs (--green is the copied-flash state, not an intent), no intent axis",
  },
  Icon: { exempt: "renders no colour of its own — the svg inherits currentColor from its rendering context" },
  LabeledSeg: {
    exempt: "no vocabulary axes; composes Segmented, which is itself structural chrome (see Segmented entry)",
  },
  ListGroup: { toneMapCoveredBy: "src/recipes/ListGroup/ListGroup.visual.test.tsx" },
  Markdown: {
    exempt: "structural: fixed --fg/--accent/--card/--muted prose-chrome pairs, no intent axis",
  },
  Modal: {
    exempt: "structural chrome: fixed --panel/--card/--accent/--muted/--fg pairs, no intent axis",
  },
  Panel: {
    exempt: "structural chrome: fixed --bg/--accent/--muted/--surface-wash-* pairs, no intent axis",
  },
  RadioGroup: {
    exempt: "shares Field.module.css structural chrome (fixed --fg/--muted/--red pairs), no intent axis",
  },
  Segmented: {
    exempt:
      "structural chrome: fixed --panel/--muted/--accent/--bg/--fg pairs (the accent segment is the SELECTED state, not an intent), no intent axis",
  },
  SelectBox: {
    exempt:
      "structural chrome: fixed --muted/--fg/--accent/--surface-wash-accent-14 pairs, no intent axis",
  },
  SideDrawer: {
    exempt: "structural chrome: fixed --panel/--surface-wash-bg-55 pairs, no intent axis",
  },
  Spinner: { exempt: "single fixed --accent ring colour, no intent axis" },
  StatusDot: { toneMapCoveredBy: "src/recipes/StatusDot/StatusDot.visual.test.tsx" },
  Switch: {
    exempt:
      "structural chrome: fixed --fg/--muted/--accent pairs (checked/unchecked is state, not intent), no intent axis",
  },
  Table: {
    exempt:
      "structural chrome: fixed --muted header colour + --surface-wash-fg-5 row hover, no intent axis; intent-bearing cell content (Chip/Badge) is that composed recipe's own coverage",
  },
  TextArea: {
    exempt: "shares Field.module.css structural chrome (fixed --fg/--muted/--red pairs), no intent axis",
  },
  TextField: {
    exempt: "shares Field.module.css structural chrome (fixed --fg/--muted/--red pairs), no intent axis",
  },
  ToastHost: { exempt: "structural chrome: fixed --card/--fg pairs, no intent axis" },
  Tooltip: {
    exempt: "structural chrome: fixed --panel/--fg/--border pairs (lifted from StatusDot's own tooltip), no intent axis",
  },
};
