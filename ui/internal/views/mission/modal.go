// Modal foldouts: the repo, branch, and worktree pickers anchored under the
// top bar's segments. One engine (ranked rows, an optional trailing action
// row, a query and a cursor) drives all three; only the row set, the
// emitted intent, and the action row differ per kind. Composition mirrors
// the picker's own overlay convention (ui/internal/views/picker/modal.go):
// the parent dims in place and the box composites over it as a lipgloss
// layer, anchored under the segment that opened it.
package mission

import (
	"encoding/json"
	"fmt"
	"image/color"
	"regexp"
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

// modalRow is one entry in a foldout: selectable unless it is a guarded
// branch, which renders but can never take the cursor.
type modalRow struct {
	text       string // matched against the typed query
	label      string // rendered primary text
	meta       string // rendered secondary text (a guard reason, a branch name, "ready")
	badge      string // pre-rendered, pre-colored ahead/behind/dirty summary
	group      string
	current    bool
	selectable bool
	guarded    bool
	value      string // emitted verbatim on enter
}

// modalActionRow is the trailing "New branch from…" / "Provision new
// worktree…" affordance. It never joins ranking: it always occupies the
// last cursor slot, after whatever the query leaves visible, so typing
// never buries or hides it.
type modalActionRow struct {
	label   string
	payload json.RawMessage
}

// modalState is one open foldout. cursor indexes into matches, except the
// value len(matches) which means "the action row" -- see slotSelectable.
type modalState struct {
	zone         zoneID
	intent       string
	placeholder  string
	buildPayload func(value string) json.RawMessage
	rows         []modalRow
	action       *modalActionRow
	query        string
	matches      []picker.Match
	cursor       int

	// hoverRow/hoverAction are the mouse's own position, independent of
	// cursor exactly as the base list's hover is independent of its
	// keyboard cursor -- see mission.go's mouseMotion. hoverRow indexes
	// matches; -1 means no row is hovered.
	hoverRow    int
	hoverAction bool
}

func newModal(zone zoneID, intent, placeholder string, buildPayload func(string) json.RawMessage, rows []modalRow, action *modalActionRow) *modalState {
	ms := &modalState{zone: zone, intent: intent, placeholder: placeholder, buildPayload: buildPayload, rows: rows, action: action, hoverRow: -1}
	ms.refilter()
	return ms
}

type repoPayload struct {
	Repo string `json:"repo"`
}

type checkoutPayload struct {
	Branch string `json:"branch"`
}

type checkoutNewPayload struct {
	New  bool   `json:"new"`
	From string `json:"from"`
}

type worktreePayload struct {
	Path string `json:"path"`
}

type worktreeNewPayload struct {
	New bool `json:"new"`
}

// newRepoModal lists every repo, grouped by RepoRow.Group. It has no action
// row: a new repo comes from cloning, not from this foldout.
func newRepoModal(m Model) *modalState {
	rows := make([]modalRow, len(m.Repos))
	for i, r := range m.Repos {
		label := r.Label
		if label == "" {
			label = r.ID
		}
		rows[i] = modalRow{
			text: label, label: label, badge: renderBadge(r.Badge),
			group: r.Group, current: r.Current, selectable: true, value: r.ID,
		}
	}
	return newModal(zoneRepo, "mission:repo", "filter repos", func(v string) json.RawMessage {
		return mustPayload(repoPayload{Repo: v})
	}, rows, nil)
}

// newBranchModal lists every branch, grouped recent/other/guarded. A branch
// is guarded exactly when GuardedBy is non-empty (the Group label is a
// display hint the driver derives from the same fact, not the source of
// truth for it). A guarded row's own GuardedBy detail never renders on the
// row itself: the group header carries the reason instead (modalGroupHeaderText),
// so the row shows only its name and, on the right, the lock (modalRowLine).
func newBranchModal(m Model) *modalState {
	rows := make([]modalRow, len(m.Branches))
	for i, b := range m.Branches {
		guarded := b.GuardedBy != ""
		badge := ""
		if !guarded {
			badge = renderAheadBehind(b.Ahead, b.Behind)
		}
		rows[i] = modalRow{
			text: b.Name, label: b.Name, badge: badge,
			group: b.Group, current: b.Current, selectable: !guarded, guarded: guarded, value: b.Name,
		}
	}
	action := &modalActionRow{
		label:   "New branch from " + m.Current.Branch + "…",
		payload: mustPayload(checkoutNewPayload{New: true, From: m.Current.Branch}),
	}
	return newModal(zoneBranch, "mission:checkout", "filter branches", func(v string) json.RawMessage {
		return mustPayload(checkoutPayload{Branch: v})
	}, rows, action)
}

// newWorktreeModal lists every worktree; on-deck ones (provisioned but not
// checked out) carry a "ready" meta alongside their branch. Its filter
// placeholder names the current repo, since a worktree only ever belongs to
// one -- mirroring its board.
func newWorktreeModal(m Model) *modalState {
	rows := make([]modalRow, len(m.Worktrees))
	for i, w := range m.Worktrees {
		label := w.Name
		if label == "" {
			label = w.Path
		}
		meta := w.Branch
		if w.OnDeck {
			meta = strings.TrimSpace(meta + "  ready")
		}
		rows[i] = modalRow{
			text: label, label: label, meta: meta, badge: renderBadge(w.Badge),
			current: w.Current, selectable: true, value: w.Path,
		}
	}
	action := &modalActionRow{
		label:   "Provision new worktree…",
		payload: mustPayload(worktreeNewPayload{New: true}),
	}
	repoLabel := m.Current.RepoLabel
	if repoLabel == "" {
		repoLabel = m.Current.Repo
	}
	return newModal(zoneWorktree, "mission:worktree", "filter worktrees · "+repoLabel, func(v string) json.RawMessage {
		return mustPayload(worktreePayload{Path: v})
	}, rows, action)
}

// renderAheadBehind is the same n↓/n↑ grammar the top bar's action pills use
// (topbar.go): Mint behind, Cyan ahead, either omitted at zero.
func renderAheadBehind(ahead, behind int) string {
	var parts []string
	if behind > 0 {
		parts = append(parts, fg(theme.Mint).Render(fmt.Sprintf("%d↓", behind)))
	}
	if ahead > 0 {
		parts = append(parts, fg(theme.Cyan).Render(fmt.Sprintf("%d↑", ahead)))
	}
	return strings.Join(parts, " ")
}

// renderBadge is a repo/worktree row's summary: a Peach dirty-file dot, the
// same ahead/behind pair renderAheadBehind renders for a branch, and a Mint
// check standing alone when there is nothing else to show and the row is
// actually clean.
func renderBadge(b Badge) string {
	var parts []string
	if dirty := b.Staged + b.Unstaged + b.Untracked + b.Conflicted; dirty > 0 {
		parts = append(parts, fg(theme.Peach).Render(fmt.Sprintf("●%d", dirty)))
	}
	if ab := renderAheadBehind(b.Ahead, b.Behind); ab != "" {
		parts = append(parts, ab)
	}
	if len(parts) == 0 && b.Clean {
		parts = append(parts, fg(theme.Mint).Render(theme.GlyphDone))
	}
	return strings.Join(parts, " ")
}

func (ms *modalState) slotCount() int {
	n := len(ms.matches)
	if ms.action != nil {
		n++
	}
	return n
}

func (ms *modalState) slotSelectable(i int) bool {
	if i == len(ms.matches) {
		return ms.action != nil
	}
	if i < 0 || i >= len(ms.matches) {
		return false
	}
	return ms.rows[ms.matches[i].Index].selectable
}

func (ms *modalState) onActionSlot() bool {
	return ms.action != nil && ms.cursor == len(ms.matches)
}

// moveCursor steps delta slots, skipping a guarded branch row as if it were
// not there. Running off either end leaves the cursor exactly where it was
// -- there is nowhere selectable in that direction, not a wraparound.
func (ms *modalState) moveCursor(delta int) {
	n := ms.slotCount()
	if n == 0 {
		return
	}
	i := ms.cursor
	for {
		i += delta
		if i < 0 || i >= n {
			return
		}
		if ms.slotSelectable(i) {
			ms.cursor = i
			return
		}
	}
}

// firstSelectableMatch scans the ranked rows only, never the trailing action
// slot: a query that leaves nothing but a guarded row must default the
// cursor onto that (unselectable) row, not slide past it onto the action
// affordance -- the guarded row still sits there to be looked at, and enter
// on it is refused by selectedRow, not silently redirected to "new branch".
// A refilter that empties the row list entirely (matches has nothing left)
// falls through to index 0, which is exactly the action slot when one
// exists (0 == len(matches)) -- the sole case sliding onto it by default is
// correct, since there is no row left to default to instead.
func (ms *modalState) firstSelectableMatch() int {
	for i := 0; i < len(ms.matches); i++ {
		if ms.rows[ms.matches[i].Index].selectable {
			return i
		}
	}
	return 0
}

// refilter re-ranks rows against the live query with the picker's own
// headless matcher, then folds each group's matches contiguous so a typed
// query never interleaves recent/other/guarded (or splits a repo's Group).
func (ms *modalState) refilter() {
	targets := make([]string, len(ms.rows))
	groups := make([]string, len(ms.rows))
	for i, r := range ms.rows {
		targets[i] = r.text
		groups[i] = r.group
	}
	matches := picker.Rank(ms.query, targets, false)
	ms.matches = picker.GroupContiguous(matches, groups)
	ms.cursor = ms.firstSelectableMatch()
}

// selectedRow reports the row under the cursor, or ok=false when the cursor
// sits on the action slot, a guarded row, or nothing at all -- the one place
// "can this be checked out" is decided, so a caller never has to re-derive
// it from selectable/guarded itself.
func (ms *modalState) selectedRow() (modalRow, bool) {
	if ms.cursor < 0 || ms.cursor >= len(ms.matches) {
		return modalRow{}, false
	}
	row := ms.rows[ms.matches[ms.cursor].Index]
	if !row.selectable {
		return modalRow{}, false
	}
	return row, true
}

// openBranchModal opens the branch foldout, or refuses with a local notice
// while HEAD is detached: there is no current branch to fold out from, and
// no checkout to land the new one against.
func (m *Mission) openBranchModal() (tea.Model, tea.Cmd) {
	if m.model.Current.Detached {
		m.localNotice = "Detached HEAD: check out a branch first"
		return m, nil
	}
	m.modal = newBranchModal(m.model)
	m.focus = focusModal
	return m, nil
}

func (m *Mission) openRepoModal() (tea.Model, tea.Cmd) {
	m.modal = newRepoModal(m.model)
	m.focus = focusModal
	return m, nil
}

func (m *Mission) openWorktreeModal() (tea.Model, tea.Cmd) {
	m.modal = newWorktreeModal(m.model)
	m.focus = focusModal
	return m, nil
}

func (m *Mission) closeModal() {
	m.modal = nil
	m.focus = focusList
}

// openZone reports which top-bar segment the open modal is anchored under,
// so View can paint that segment in its "open" state -- zoneNone (no
// highlight) when nothing is open.
func (m *Mission) openZone() zoneID {
	if m.modal == nil {
		return zoneNone
	}
	return m.modal.zone
}

func (m *Mission) modalKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	ms := m.modal
	switch v.String() {
	case "esc":
		m.closeModal()
		return m, nil
	case "up":
		ms.moveCursor(-1)
		return m, nil
	case "down":
		ms.moveCursor(1)
		return m, nil
	case "ctrl+n":
		return m.selectModalAction()
	case "enter":
		return m.selectModalRow()
	case "backspace":
		if r := []rune(ms.query); len(r) > 0 {
			ms.query = string(r[:len(r)-1])
			ms.refilter()
		}
		return m, nil
	}
	if v.Text != "" {
		ms.query += v.Text
		ms.refilter()
	}
	return m, nil
}

func (m *Mission) selectModalRow() (tea.Model, tea.Cmd) {
	ms := m.modal
	if ms.onActionSlot() {
		return m.selectModalAction()
	}
	row, ok := ms.selectedRow()
	if !ok {
		return m, nil
	}
	intent, payload := ms.intent, ms.buildPayload(row.value)
	m.closeModal()
	return m, m.em.Emit(protocol.Intent{Name: intent, Payload: payload})
}

// selectModalAction fires the trailing action row's fixed payload
// regardless of where the cursor sits -- ctrl-n's own path, and the one
// enter takes when the cursor already sits on the action slot. A repo
// modal has no action row, so ctrl-n there is simply a no-op.
func (m *Mission) selectModalAction() (tea.Model, tea.Cmd) {
	ms := m.modal
	if ms.action == nil {
		return m, nil
	}
	intent, payload := ms.intent, ms.action.payload
	m.closeModal()
	return m, m.em.Emit(protocol.Intent{Name: intent, Payload: payload})
}

// modalContentMin/Max floor and cap the foldout's inner content width so a
// short list still reads as a box and a long label never stretches it to
// the pane.
const (
	modalContentMin = 32
	modalContentMax = 60
)

// modalWidth mirrors modalRowLine/modalActionLine's own fixed-column
// formulas exactly (bar + status + gap before the label, a space-led meta,
// a gap-led badge) so a row's label gets its full width rather than losing
// cells to a looser estimate here that undercounts those fixed columns.
func modalWidth(ms *modalState) int {
	need := modalContentMin
	consider := func(w int) {
		if w > need {
			need = w
		}
	}
	const rowPrefix = 3 // bar + status glyph + gap
	for _, r := range ms.rows {
		w := rowPrefix + lipgloss.Width(r.label)
		if r.meta != "" {
			w += 1 + lipgloss.Width(r.meta)
		}
		// A guarded row's real right-edge content is the lock glyph, not its
		// (empty) badge field -- see modalRowLine's own guarded override.
		badgeW := lipgloss.Width(r.badge)
		if r.guarded {
			badgeW = lipgloss.Width(theme.GlyphLock)
		}
		if badgeW > 0 {
			w += 1 + badgeW
		}
		consider(w)
	}
	if ms.action != nil {
		consider(2 + lipgloss.Width(ms.action.label)) // bar + gap
	}
	consider(1 + lipgloss.Width(modalKeybarPlainText(ms.zone)))
	if need > modalContentMax {
		need = modalContentMax
	}
	return need
}

func modalFilterLine(query, placeholder string, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	text := bg.Foreground(theme.Faint).Render(placeholder)
	if query != "" {
		text = bg.Foreground(theme.Text).Render(query)
	}
	left := bg.Foreground(theme.Pink).Render(theme.GlyphChevron+" ") + text
	return bg.Width(width).Render(left)
}

func modalRuleLine(width int) string {
	return lipgloss.NewStyle().Background(theme.Surface).Foreground(theme.Rule).Render(strings.Repeat("─", width))
}

func modalNoMatchLine(width int) string {
	return lipgloss.NewStyle().Background(theme.Surface).Foreground(theme.Faint).Width(width).Render(" no matches")
}

// modalJustify fills width on bg, left pinned left and right pinned right --
// every box line needs its own explicit background since the box composites
// over the dimmed parent rather than printing at the terminal's own ambient
// background (mirrors the picker's own modalJustify).
func modalJustify(bg lipgloss.Style, width int, left, right string) string {
	avail := width - lipgloss.Width(left) - lipgloss.Width(right)
	if avail < 0 {
		avail = 0
	}
	return left + bg.Render(strings.Repeat(" ", avail)) + right
}

// modalRowLine paints one row: a cursor bar, a status glyph (current dot or
// blank), the label and meta, and the badge pinned right -- a guarded row's
// badge slot is the lock instead of any ahead/behind summary, Dimmer like
// the rest of its (name-only) content. hover paints HoverBg, but only when
// cursor is false -- the keyboard cursor's SelBg always wins, mirroring the
// base list's own row/cursor split (changes.go's renderChangeRow).
func modalRowLine(r modalRow, width int, cursor, hover bool) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	switch {
	case cursor:
		bg = bg.Background(theme.SelBg)
	case hover:
		bg = bg.Background(theme.HoverBg)
	}
	bar, barColor := " ", theme.Text
	if cursor {
		bar, barColor = theme.GlyphBar, theme.Pink
	}
	status, statusColor := " ", theme.Text
	if r.current {
		status, statusColor = theme.GlyphOn, theme.Mint
	}
	textColor := theme.Text
	if r.guarded {
		textColor = theme.Dimmer
	}

	meta := ""
	if r.meta != "" {
		meta = bg.Foreground(theme.Dimmer).Render(" " + r.meta)
	}
	badge := bg.Render(r.badge)
	if r.guarded {
		badge = bg.Foreground(theme.Dimmer).Render(theme.GlyphLock)
	}

	fixed := 1 + 1 + 1 + lipgloss.Width(meta) + lipgloss.Width(badge)
	if lipgloss.Width(badge) > 0 {
		fixed++
	}
	labelW := width - fixed
	if labelW < 1 {
		labelW = 1
	}
	label := bg.Foreground(textColor).Render(clip(r.label, labelW))

	left := bg.Foreground(barColor).Render(bar) + bg.Foreground(statusColor).Render(status) + bg.Render(" ") + label + meta
	return modalJustify(bg, width, left, badge)
}

// modalActionLine paints the trailing action row: always Lav (an action row
// reads as chrome, not as one more entry -- theme.go's own comment on
// ActionFg/ActionSelBg), its background lifting to ActionHighlight while it
// holds the cursor, or plain HoverBg while only hovered.
func modalActionLine(a *modalActionRow, width int, cursor, hover bool) string {
	bgColor := theme.Surface
	switch {
	case cursor:
		bgColor = theme.ActionHighlight(theme.Lav)
	case hover:
		bgColor = theme.HoverBg
	}
	bg := lipgloss.NewStyle().Background(bgColor)
	bar := " "
	if cursor {
		bar = theme.GlyphBar
	}
	left := bg.Foreground(theme.Lav).Render(bar + " " + clip(a.label, width-3))
	return bg.Width(width).Render(left)
}

func modalGroupBoundary(ms *modalState, i int) bool {
	if i == 0 {
		return false
	}
	cur := ms.rows[ms.matches[i].Index].group
	prev := ms.rows[ms.matches[i-1].Index].group
	return cur != prev
}

// modalGroupHeaderText resolves a group's header label for the repo and
// branch modals (the worktree modal never groups -- see modalHeaderBefore).
// A branch's guarded group always renders the fixed reason banner: each
// row's own GuardedBy detail is dropped entirely (newBranchModal never
// copies it onto the row), not merely hidden behind this label. Every other
// group -- "recent", "other", a repo's own Group value -- renders as-is.
func modalGroupHeaderText(zone zoneID, group string) string {
	if zone == zoneBranch && group == "guarded" {
		return "guarded · checked out in another worktree"
	}
	return group
}

// modalHeaderBefore reports the header text that belongs immediately before
// match i, or "" for none. The repo and branch modals label every group,
// including the first (GroupContiguous orders "recent" first in practice,
// and it still needs its own header); the worktree modal carries no Group
// data and never renders one.
func modalHeaderBefore(ms *modalState, i int) string {
	if ms.zone != zoneRepo && ms.zone != zoneBranch {
		return ""
	}
	if i != 0 && !modalGroupBoundary(ms, i) {
		return ""
	}
	return modalGroupHeaderText(ms.zone, ms.rows[ms.matches[i].Index].group)
}

// modalGroupHeaderLine paints a group boundary's label: Dimmer text on the
// box's own Surface background, replacing the plain rule a boundary used to
// draw -- the boards' own group-label convention.
func modalGroupHeaderLine(text string, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	return bg.Width(width).Render(bg.Foreground(theme.Dimmer).Render(" " + text))
}

// modalKeybarPairs lists a zone's wired key/label pairs, in display order:
// only what this modal actually dispatches, never the boards' unwired
// ctrl-f/ctrl-w/ctrl-d.
func modalKeybarPairs(zone zoneID) [][2]string {
	switch zone {
	case zoneRepo:
		return [][2]string{{"enter", "open"}, {"esc", "close"}}
	case zoneBranch:
		return [][2]string{{"enter", "checkout"}, {"ctrl-n", "new branch"}, {"esc", "close"}}
	case zoneWorktree:
		return [][2]string{{"enter", "switch"}, {"ctrl-n", "provision"}, {"esc", "close"}}
	default:
		return nil
	}
}

func modalKeybarPlainText(zone zoneID) string {
	pairs := modalKeybarPairs(zone)
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = p[0] + " " + p[1]
	}
	return strings.Join(parts, " · ")
}

// modalKeybarLine is the foldout's own keybar, inside the border: the same
// key/label/dot grammar the main keybar uses (changes.go's renderKeybar),
// painted on the box's own Surface background.
func modalKeybarLine(zone zoneID, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	dot := bg.Foreground(theme.Dim).Render(" · ")
	key := func(k, label string) string {
		return bg.Foreground(theme.KeybarKey).Bold(true).Render(k) + bg.Foreground(theme.KeybarLabel).Render(" "+label)
	}
	pairs := modalKeybarPairs(zone)
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = key(p[0], p[1])
	}
	left := bg.Render(" ") + clipOn(strings.Join(parts, dot), width-1, bg)
	return bg.Width(width).Render(left)
}

// modalBoxLines lays out the foldout's full content: the filter line, the
// ranked rows (each labeled group's header in place of the rule a boundary
// used to draw), the action row when the kind has one, and -- always, even
// with nothing above it to show -- the closing rule and this foldout's own
// keybar.
func modalBoxLines(ms *modalState, width int) []string {
	lines := []string{modalFilterLine(ms.query, ms.placeholder, width), modalRuleLine(width)}
	switch {
	case len(ms.matches) == 0 && ms.action == nil:
		lines = append(lines, modalNoMatchLine(width))
	default:
		for i := range ms.matches {
			if text := modalHeaderBefore(ms, i); text != "" {
				lines = append(lines, modalGroupHeaderLine(text, width))
			}
			lines = append(lines, modalRowLine(ms.rows[ms.matches[i].Index], width, i == ms.cursor, i == ms.hoverRow))
		}
		if ms.action != nil {
			lines = append(lines, modalRuleLine(width))
			lines = append(lines, modalActionLine(ms.action, width, ms.onActionSlot(), ms.hoverAction))
		}
	}
	lines = append(lines, modalRuleLine(width))
	lines = append(lines, modalKeybarLine(ms.zone, width))
	return lines
}

func modalBoxFrame(lines []string) string {
	content := strings.Join(lines, "\n")
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.Panel).
		BorderBackground(theme.Surface).
		Background(theme.Surface).
		Render(content)
}

// segmentOrigin mirrors renderTopBar's own layout math (topbar.go) so the
// box lands under the exact segment column that opened it: repo owns column
// 0, worktree and branch split the remainder the same way renderTopBar does.
func segmentOrigin(zone zoneID, width int) int {
	const dividers = 3
	remaining := width - sidebarWidth - dividers
	if remaining < 0 {
		remaining = 0
	}
	segW := remaining / 3
	switch zone {
	case zoneWorktree:
		return sidebarWidth + 1
	case zoneBranch:
		return sidebarWidth + 1 + segW + 1
	default:
		return 0
	}
}

func clampX(x, boxW, parentW int) int {
	if x+boxW > parentW {
		x = parentW - boxW
	}
	if x < 0 {
		x = 0
	}
	return x
}

// renderMissionModal composites ms's box over parent: the parent dims in
// place (dimForeground), the box lands as a layer anchored under its
// segment, clamped so it never runs past the pane -- the picker's own
// overlay idiom (ui/internal/views/picker/modal.go's renderModal),
// mirrored locally since dimForeground and its ramp are unexported there.
func renderMissionModal(parent string, ms *modalState, width, topBarHeight int) string {
	dimmed := dimForeground(parent)
	inner := modalWidth(ms)
	if inner > width-2 {
		inner = width - 2
	}
	if inner < 1 {
		inner = 1
	}
	box := modalBoxFrame(modalBoxLines(ms, inner))

	x := clampX(segmentOrigin(ms.zone, width), lipgloss.Width(box), width)
	y := topBarHeight

	parentLayer := lipgloss.NewLayer(dimmed).X(0).Y(0).Z(0)
	modalLayer := lipgloss.NewLayer(box).X(x).Y(y).Z(1)
	return lipgloss.NewCompositor(parentLayer, modalLayer).Render()
}

// renderNoticeStrip is the one-line refusal banner at the frame's bottom.
// It paints whichever notice noticeText (mission.go) resolved: the wire
// Model's own Notice (a driver refusal) or the view-local one.
func renderNoticeStrip(text string, width int) string {
	on := lipgloss.NewStyle().Background(theme.WarnBg)
	left := on.Foreground(theme.Peach).Render(theme.GlyphWarn + " " + text)
	return on.Width(width).Render(" " + left)
}

// The rest of this file mirrors the picker's parent-dim transform
// (ui/internal/views/picker/modal.go's dimForeground/dimRamp/dimBlend)
// locally: those helpers are unexported there, so reuse is by idiom, not
// import.

var modalDimRamp = map[string]string{
	rgbKeyOf(theme.Text):     rgbKeyOf(theme.Dim),
	rgbKeyOf(theme.TextSoft): rgbKeyOf(theme.Dimmer),
	rgbKeyOf(theme.Dim):      rgbKeyOf(theme.Dimmer),
	rgbKeyOf(theme.Dimmer):   rgbKeyOf(theme.Faint),
	rgbKeyOf(theme.Faint):    rgbKeyOf(theme.Faint),
}

func rgbKeyOf(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("%d;%d;%d", r>>8, g>>8, b>>8)
}

const modalDimBlend = 0.4

func modalBlendChannel(v, target int) int {
	return v + int(float64(target-v)*modalDimBlend)
}

func modalBlendTowardBg(r, g, b int) (int, int, int) {
	br, bgc, bb, _ := theme.Bg.RGBA()
	return modalBlendChannel(r, int(br>>8)), modalBlendChannel(g, int(bgc>>8)), modalBlendChannel(b, int(bb>>8))
}

var modalFgSGR = regexp.MustCompile(`38;2;(\d{1,3});(\d{1,3});(\d{1,3})`)

func dimForeground(s string) string {
	idxs := modalFgSGR.FindAllStringSubmatchIndex(s, -1)
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
		dimmed, ok := modalDimRamp[key]
		if !ok {
			nr, ng, nb := modalBlendTowardBg(r, g, b)
			dimmed = fmt.Sprintf("%d;%d;%d", nr, ng, nb)
		}
		out.WriteString("38;2;" + dimmed)
		last = loc[1]
	}
	out.WriteString(s[last:])
	return out.String()
}
