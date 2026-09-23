package picker

import (
	"fmt"
	"image/color"
	"regexp"
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// MenuAnchor is the frame cell a right-click opened a menu at.
type MenuAnchor struct{ X, Y int }

// MenuItem is one menu row. A rule paints between two visible rows whose
// Section differs.
type MenuItem struct {
	ID       string
	Label    string
	Hint     string
	Section  int
	Quiet    bool
	Disabled bool
	Value    string
}

type MenuOutcomeKind int

const (
	MenuStay MenuOutcomeKind = iota
	MenuClosed
	MenuChosen
	MenuNamed
	MenuPassthrough
)

type MenuOutcome struct {
	Kind MenuOutcomeKind
	Item MenuItem
	Name string
	Key  string
}

type menuRow struct {
	text     string
	hint     string
	section  int
	quiet    bool
	disabled bool
	id       string
	value    string
}

func (r menuRow) item() MenuItem {
	return MenuItem{ID: r.id, Label: r.text, Hint: r.hint, Section: r.section, Quiet: r.quiet, Disabled: r.disabled, Value: r.value}
}

// Menu is an anchored, filterable overlay box composited over a dimmed
// parent frame. It carries its own query/cursor so typing narrows its rows
// exactly like the picker's main list, and its own hit record so a caller
// routes mouse events through Click/Motion without re-deriving the box's
// placement.
type Menu struct {
	title   string
	rows    []menuRow
	query   string
	matches []Match
	cursor  int
	// anchor is the frame cell the box's top-left corner lands on (see
	// origin). Nil centers the box.
	anchor *MenuAnchor
	// hover is the match index the pointer is over (-1 = none): a render
	// hint modalRowLine paints HoverBg on, never the keyboard cursor.
	hover int
	// zones and box are the hit record Render rebuilds on every paint: zones
	// maps a frame line to the row painted there, box is the frame rectangle
	// a press outside dismisses on. Both are recorded against the
	// compositor's own origin (see recordZones).
	zones hitZones
	box   modalBoxRect
}

func NewMenu(title string, items []MenuItem, anchor *MenuAnchor) *Menu {
	rows := make([]menuRow, len(items))
	for i, it := range items {
		rows[i] = menuRow{text: it.Label, hint: it.Hint, section: it.Section, quiet: it.Quiet, disabled: it.Disabled, id: it.ID, value: it.Value}
	}
	mn := &Menu{title: title, rows: rows, anchor: anchor, hover: -1}
	mn.refilter()
	return mn
}

func (mn *Menu) Title() string { return mn.title }

func (mn *Menu) SetAnchor(a *MenuAnchor) { mn.anchor = a }

// refilter re-ranks the menu's rows against its own query, reusing the same
// fzf-backed Rank the main list filters with so a menu with many rows
// narrows the same way. Each section stays one contiguous block, in the
// order sections first appear in the items, with rank order kept inside it:
// a filtered box then paints at most one rule per section boundary and is
// never taller than the unfiltered BoxHeight a caller reserved.
func (mn *Menu) refilter() {
	targets := make([]string, len(mn.rows))
	sections := make([]string, len(mn.rows))
	for i, r := range mn.rows {
		targets[i] = r.text
		sections[i] = strconv.Itoa(r.section)
	}
	mn.matches = GroupContiguous(Rank(mn.query, targets, false), sections)
	mn.cursor = 0
}

func (mn *Menu) moveCursor(delta int) {
	n := len(mn.matches)
	if n == 0 {
		return
	}
	mn.cursor += delta
	if mn.cursor < 0 {
		mn.cursor = 0
	}
	if mn.cursor >= n {
		mn.cursor = n - 1
	}
}

// chosen reports the row under the cursor; an empty filtered view has none
// and keeps the menu open.
func (mn *Menu) chosen() MenuOutcome {
	if mn.cursor < 0 || mn.cursor >= len(mn.matches) {
		return MenuOutcome{Kind: MenuStay}
	}
	return MenuOutcome{Kind: MenuChosen, Item: mn.rows[mn.matches[mn.cursor].Index].item()}
}

// Key handles a key press while the menu is open: navigation and typing
// stay local, esc closes, enter chooses the cursor row.
func (mn *Menu) Key(msg tea.KeyPressMsg) MenuOutcome {
	switch msg.String() {
	case "esc":
		return MenuOutcome{Kind: MenuClosed}
	case "down":
		mn.moveCursor(1)
		return MenuOutcome{Kind: MenuStay}
	case "up":
		mn.moveCursor(-1)
		return MenuOutcome{Kind: MenuStay}
	case "enter":
		return mn.chosen()
	case "backspace":
		if r := []rune(mn.query); len(r) > 0 {
			mn.query = string(r[:len(r)-1])
			mn.refilter()
		}
		return MenuOutcome{Kind: MenuStay}
	}
	if msg.Text != "" {
		mn.query += msg.Text
		mn.refilter()
		return MenuOutcome{Kind: MenuStay}
	}
	// A key that types nothing is never filter input, so the caller may fire
	// a binding for it straight from the menu. The menu's own keys above take
	// precedence, and a plain character always filters, so a passthrough is
	// only ever a modifier combo or a special key.
	return MenuOutcome{Kind: MenuPassthrough, Key: canonicalKey(msg)}
}

// Click routes a press against the box Render last painted: a press on a row
// chooses it through the same path enter takes (set the cursor, then
// choose), a press anywhere outside the box closes the menu, and a press
// inside the box but off any row stays.
func (mn *Menu) Click(x, y int) MenuOutcome {
	if zone, ok := mn.zones.at(x, y); ok && zone.kind == zoneModalRow {
		mn.cursor = zone.row
		return mn.chosen()
	}
	if !mn.box.contains(x, y) {
		return MenuOutcome{Kind: MenuClosed}
	}
	return MenuOutcome{Kind: MenuStay}
}

// Motion tracks which row the pointer is over. It sets hover and never the
// keyboard cursor, so moving the mouse across the menu can never steal it.
func (mn *Menu) Motion(x, y int) {
	if zone, ok := mn.zones.at(x, y); ok && zone.kind == zoneModalRow {
		mn.hover = zone.row
	} else {
		mn.hover = -1
	}
}

// Render composites the menu over the already-rendered parent frame: the
// parent dims (DimForeground), the box sits on top of it as a lipgloss v2
// layer at origin -- Draw only touches the cells inside its own bounds, so
// nothing outside the box has to be repainted by hand.
func (mn *Menu) Render(parent string, width int) string {
	dimmed := DimForeground(parent)
	inner := modalInner(mn, width)
	lines, rowLines := modalBoxLines(mn, inner, mn.hover)
	box := modalBoxFrame(lines)

	pw := width
	ph := lipgloss.Height(dimmed)
	mw := lipgloss.Width(box)
	mh := lipgloss.Height(box)

	x, y := mn.origin(pw, ph, mw, mh)

	mn.recordZones(x, y, mw, mh, inner, rowLines)

	parentLayer := lipgloss.NewLayer(dimmed).X(0).Y(0).Z(0)
	modalLayer := lipgloss.NewLayer(box).X(x).Y(y).Z(1)
	return lipgloss.NewCompositor(parentLayer, modalLayer).Render()
}

// BoxHeight is the height the unhovered box occupies at width, so a caller
// can reserve room for it before it opens.
func (mn *Menu) BoxHeight(width int) int {
	lines, _ := modalBoxLines(mn, modalInner(mn, width), -1)
	return lipgloss.Height(modalBoxFrame(lines))
}

// origin places a (mw x mh) box in a (pw x ph) frame. Anchored (a
// right-click), the box's top-left corner is the pointer cell, the way a
// desktop context menu opens under the cursor, and it slides left and up
// only as far as needed to stay inside the frame. Unanchored, it centers.
func (mn *Menu) origin(pw, ph, mw, mh int) (x, y int) {
	if mn.anchor == nil {
		x, y = (pw-mw)/2, (ph-mh)/2
	} else {
		x, y = mn.anchor.X, mn.anchor.Y
		if x+mw > pw {
			x = pw - mw
		}
		if y+mh > ph {
			y = ph - mh
		}
	}
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	return x, y
}

// recordZones rebuilds mn.zones and mn.box for the box currently composited
// at frame origin (boxX, boxY) with size (boxW, boxH), off the same rowLines
// the box was painted from.
//
// Offset invariant: the box is a compositor layer at its own origin, not
// inline content, so a menu row's frame line is the box origin plus one border
// line plus that row's content-line offset (boxY + 1 + rowLines[i]), and its
// clickable column span is the box origin plus one border column across the
// inner width ([boxX+1, boxX+1+inner)). Mapping a mouse cell straight against
// the base list's row coordinates (which start at frame line 0) would miss
// the box entirely -- honoring this origin is the whole point of recording
// here, where the compositor's own placement is known.
func (mn *Menu) recordZones(boxX, boxY, boxW, boxH, inner int, rowLines []int) {
	zones := hitZones{}
	xStart := boxX + 1
	xEnd := xStart + inner
	for i, cl := range rowLines {
		frameY := boxY + 1 + cl
		zones.addAll(frameY, []mouseZone{{kind: zoneModalRow, xStart: xStart, xEnd: xEnd, row: i}})
	}
	mn.zones = zones
	mn.box = modalBoxRect{x0: boxX, y0: boxY, x1: boxX + boxW, y1: boxY + boxH, valid: true}
}

// modalBoxRect is the open menu's bordered frame rectangle, recorded by
// recordZones so a press outside it can be told apart from one on a row
// (a dismiss vs. an activate). Half-open on both axes: [x0,x1) x [y0,y1).
// valid is false until a render has recorded one, so a click that somehow
// arrives before the first paint reads as outside rather than as the
// zero rectangle's corner.
type modalBoxRect struct {
	x0, y0, x1, y1 int
	valid          bool
}

func (r modalBoxRect) contains(x, y int) bool {
	return r.valid && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1
}

// modalMinWidth floors the menu's content width so a one-row menu still
// reads as a box rather than a sliver.
const modalMinWidth = 24

// surfaceBg is the menu's own background -- every line painted inside
// the box carries it explicitly (unlike the main list's onBg, which paints
// at the terminal's native background) since the box is composited over
// the dimmed parent rather than printed inline: a cell left with no
// explicit background renders at the terminal's ambient default, not
// "see-through" to whatever the parent drew there.
var surfaceBg = lipgloss.NewStyle().Background(theme.Surface)

func sfg(c color.Color) lipgloss.Style {
	return surfaceBg.Foreground(c)
}

// modalInner is the menu's inner content width, capped to the pane and
// floored to modalMinWidth -- shared by BoxHeight, Render and recordZones so
// a row's clickable column span can never drift from the width it paints
// at.
func modalInner(mn *Menu, parentWidth int) int {
	maxInner := parentWidth - 4
	if maxInner < modalMinWidth {
		maxInner = modalMinWidth
	}
	return modalContentWidth(mn, maxInner)
}

// modalBoxLines builds the menu's inner lines and, in the same pass, the
// content-line offset each visible row lands on (rowLines[i] for match i).
// The two are returned together so recordZones can position a row's
// hit-zone against exactly the line this appended it on, never a second walk
// that could order the header/filter/rule/divider run differently. hover is
// the match index the pointer is over (-1 = none), painted HoverBg unless it
// is also the keyboard cursor.
func modalBoxLines(mn *Menu, inner, hover int) (lines []string, rowLines []int) {
	lines = []string{
		modalHeaderLine(mn, inner),
		modalFilterLine(mn, inner),
		modalRuleLine(inner),
	}
	if len(mn.matches) == 0 {
		lines = append(lines, modalNoMatchLine(inner))
		return lines, nil
	}
	rowLines = make([]int, len(mn.matches))
	for i, mt := range mn.matches {
		if mn.dividerBefore(i) {
			lines = append(lines, modalRuleLine(inner))
		}
		rowLines[i] = len(lines)
		lines = append(lines, modalRowLine(mn.rows[mt.Index], inner, i == mn.cursor, i == hover))
	}
	return lines, rowLines
}

// modalBoxFrame wraps the menu's content lines in the Panel-colored
// rounded border on the Surface background.
func modalBoxFrame(lines []string) string {
	content := strings.Join(lines, "\n")
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.Panel).
		BorderBackground(theme.Surface).
		Background(theme.Surface).
		Render(content)
}

// dividerBefore reports whether a rule belongs between matches[i-1] and
// matches[i] in the menu's current (possibly filtered) order -- mirrors
// render.go's headerBoundary, but on a section change instead of a group
// label.
func (mn *Menu) dividerBefore(i int) bool {
	return i > 0 && mn.rows[mn.matches[i].Index].section != mn.rows[mn.matches[i-1].Index].section
}

// modalTitleCap bounds how much the title can widen the menu. The rows are
// what size the box; a long cursor row (a full script command line) only
// clips in the header (modalHeaderLine) rather than stretching the menu to
// the pane.
const modalTitleCap = 40

func modalContentWidth(mn *Menu, maxInner int) int {
	titleW := lipgloss.Width(mn.title)
	if titleW > modalTitleCap {
		titleW = modalTitleCap
	}
	need := titleW + lipgloss.Width("esc dismiss") + 4
	for _, r := range mn.rows {
		w := 2 + lipgloss.Width(r.text)
		if r.hint != "" {
			w += 1 + lipgloss.Width(r.hint)
		}
		if w > need {
			need = w
		}
	}
	if need > maxInner {
		need = maxInner
	}
	if need < modalMinWidth {
		need = modalMinWidth
	}
	return need
}

// modalJustify fills width with bg's background, left text pinned left and
// right text pinned right -- the menu's own version of render.go's
// justify, needed because every menu line has to carry an explicit
// background (see surfaceBg) rather than the main list's native-background
// convention.
func modalJustify(width int, bg lipgloss.Style, left, right string) string {
	avail := width - lipgloss.Width(left)
	if avail < 0 {
		avail = 0
	}
	return left + lipgloss.PlaceHorizontal(avail, lipgloss.Right, right, lipgloss.WithWhitespaceStyle(bg))
}

// modalHeaderLine clips mn.title to what's actually left of width once the
// margin, the "esc dismiss" hint, and a gap column ahead of it are spoken
// for. modalContentWidth already sizes the box for the title in the common
// case, but caps at maxInner, and the title is caller-supplied text with no
// length bound -- one long enough to hit that cap would otherwise render
// past width uncapped, the one line in the box modalRowLine's own clipping
// convention didn't already cover.
func modalHeaderLine(mn *Menu, width int) string {
	const rightText = "esc dismiss"
	titleBudget := width - 1 - 1 - lipgloss.Width(rightText)
	if titleBudget < 0 {
		titleBudget = 0
	}
	kept, truncated := clipRunes(mn.title, titleBudget)
	title := kept
	if truncated {
		title += "…"
	}
	left := surfaceBg.Render(" ") + sfg(theme.Text).Bold(true).Render(title)
	right := sfg(theme.Meta).Render(rightText)
	return modalJustify(width, surfaceBg, left, right)
}

func modalFilterLine(mn *Menu, width int) string {
	left := surfaceBg.Render(" ") + sfg(theme.Pink).Render(theme.GlyphChevron+" ")
	if mn.query == "" {
		left += sfg(theme.Faint).Render("filter…")
	} else {
		left += sfg(theme.Text).Render(mn.query)
	}
	return modalJustify(width, surfaceBg, left, "")
}

func modalRuleLine(width int) string {
	return sfg(theme.Rule).Render(strings.Repeat("─", width))
}

func modalNoMatchLine(width int) string {
	left := surfaceBg.Render(" ") + sfg(theme.Faint).Render("no matches")
	return modalJustify(width, surfaceBg, left, "")
}

// modalRowLine paints one row: a 1-column gutter (pink bar on the menu's
// own cursor row, blank otherwise), the label, and the hint pinned right.
// Rows read at TextSoft, quiet rows at Dimmer -- the Actions board's
// registry menu renders global (structural, always-there) actions quieter
// than the item-scope ones a caller declared for this row.
// A hovered non-cursor row carries HoverBg, the same mouse hint the base
// list paints (see rowLineWidth); the keyboard cursor's SelBg always wins,
// so hover and cursor never both style one row.
func modalRowLine(row menuRow, width int, cursor, hover bool) string {
	rowBg := surfaceBg
	gutterGlyph := " "
	gutterStyle := surfaceBg
	switch {
	case cursor:
		rowBg = lipgloss.NewStyle().Background(theme.SelBg)
		gutterGlyph = theme.GlyphBar
		gutterStyle = rowBg.Foreground(theme.Pink)
	case hover:
		rowBg = lipgloss.NewStyle().Background(theme.HoverBg)
	}
	gutter := gutterStyle.Render(gutterGlyph)

	textColor := theme.TextSoft
	if row.quiet {
		textColor = theme.Dimmer
	}

	hintWidth := 0
	if row.hint != "" {
		hintWidth = 1 + lipgloss.Width(row.hint)
	}
	textBudget := width - 2 - hintWidth
	if textBudget < 0 {
		textBudget = 0
	}
	kept, truncated := clipRunes(row.text, textBudget)
	text := " " + kept
	if truncated {
		text += "…"
	}

	hint := ""
	if row.hint != "" {
		hint = rowBg.Foreground(theme.KeybarKey).Render(row.hint)
	}

	left := gutter + rowBg.Foreground(textColor).Render(text)
	return modalJustify(width, rowBg, left, hint)
}

// fgTrueColorSGR matches a truecolor foreground escape's "38;2;R;G;B"
// parameter run wherever it appears in an already-rendered ANSI frame.
// Combined SGRs (bold+fg, fg+bg) put several parameter runs in one escape,
// so matching the run itself -- not the whole escape sequence -- is what
// lets one substitution pass dim every foreground color without disturbing
// bold, background, or reset codes sitting next to it.
var fgTrueColorSGR = regexp.MustCompile(`38;2;(\d{1,3});(\d{1,3});(\d{1,3})`)

// dimRamp is rt's text ramp stepped down one level, keyed by each tone's
// decimal "R;G;B" (how lipgloss actually renders a truecolor SGR) so
// DimForeground can look a match up with no parsing beyond what the regex
// already captured. Faint has nothing dimmer below it, so it maps to
// itself -- the floor of the ramp, not an omission.
var dimRamp = map[string]string{
	rgbKey(theme.Text):     rgbKey(theme.Dim),
	rgbKey(theme.TextSoft): rgbKey(theme.Dimmer),
	rgbKey(theme.Dim):      rgbKey(theme.Dimmer),
	rgbKey(theme.Dimmer):   rgbKey(theme.Faint),
	rgbKey(theme.Faint):    rgbKey(theme.Faint),
}

func rgbKey(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("%d;%d;%d", r>>8, g>>8, b>>8)
}

// dimBlend is how far an out-of-ramp foreground color (an accent like Pink
// or Cyan, or a row's own explicit hex) is blended toward the picker's
// background when it has no named dimmer rung to step to.
const dimBlend = 0.4

func blendTowardBg(r, g, b int) (int, int, int) {
	br, bg, bb, _ := theme.Bg.RGBA()
	return blendChannel(r, int(br>>8)), blendChannel(g, int(bg>>8)), blendChannel(b, int(bb>>8))
}

func blendChannel(v, target int) int {
	return v + int(float64(target-v)*dimBlend)
}

// DimForeground steps down every truecolor foreground color in an
// already-rendered frame: this is the whole dimming transform, run once
// over the composed parent string, rather than a "dimmed" flag threaded
// through render.go's many fg() call sites. Named text-ramp tones map
// through dimRamp exactly; any other explicit foreground color (an accent,
// or a row's own hex) blends toward the background instead, since it has
// no lower rung to step to.
func DimForeground(s string) string {
	idxs := fgTrueColorSGR.FindAllStringSubmatchIndex(s, -1)
	if idxs == nil {
		return s
	}
	var out strings.Builder
	last := 0
	for _, loc := range idxs {
		out.WriteString(s[last:loc[0]])
		r, _ := strconv.Atoi(s[loc[2]:loc[3]])
		g, _ := strconv.Atoi(s[loc[4]:loc[5]])
		b, _ := strconv.Atoi(s[loc[6]:loc[7]])
		key := fmt.Sprintf("%d;%d;%d", r, g, b)
		dimmed, ok := dimRamp[key]
		if !ok {
			nr, ng, nb := blendTowardBg(r, g, b)
			dimmed = fmt.Sprintf("%d;%d;%d", nr, ng, nb)
		}
		out.WriteString("38;2;" + dimmed)
		last = loc[1]
	}
	out.WriteString(s[last:])
	return out.String()
}
