// Modal foldouts: the repo, branch, and worktree pickers anchored under the
// top bar's segments. One engine (ranked rows, an optional trailing action
// row, a query and a cursor) drives all three; only the row set, the
// emitted intent, and the action row differ per kind. Composition mirrors
// the picker's own overlay convention (ui/internal/views/picker/menu.go):
// the parent dims in place and the box composites over it as a lipgloss
// layer, anchored under the segment that opened it.
package mission

import (
	"encoding/json"
	"fmt"
	"strings"

	"charm.land/bubbles/v2/textinput"
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
	badgeData  Badge  // ahead/behind/dirty summary; rendered at PAINT time (modalRowLine), not here, since its background must match the row's own dynamic cursor/hover fill
	when       string // branch modal only: a non-current row's relative date, right-aligned in the badge's own slot instead of ahead/behind pills
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
	label        string
	buildPayload func(name string) json.RawMessage
}

// modalState is one open foldout. cursor indexes into matches, except the
// value len(matches) which means "the action row" -- see slotSelectable.
type modalState struct {
	zone            zoneID
	intent          string
	placeholder     string
	namePlaceholder string
	buildPayload    func(value string) json.RawMessage
	rows            []modalRow
	action          *modalActionRow
	query           string
	matches         []picker.Match
	cursor          int

	// naming is the action row's second step: ctrl-n opens a name field in
	// place of the filter line and only the following enter emits. The
	// field is separate from query because refilter() resets the cursor on
	// every keystroke, which a name being typed must not do.
	naming    bool
	nameInput textinput.Model

	// hoverRow/hoverAction are the mouse's own position, independent of
	// cursor exactly as the base list's hover is independent of its
	// keyboard cursor -- see mission.go's mouseMotion. hoverRow indexes
	// matches; -1 means no row is hovered.
	hoverRow    int
	hoverAction bool

	// scrollTop is the row region's own scroll window top (an index into
	// modalDisplayLines), the same role Mission.diffTop/changesTop play for
	// their own scrolling regions -- persisted across renders so a click
	// resolves against the exact window the last render painted.
	scrollTop int
}

func newModal(zone zoneID, intent, placeholder, namePlaceholder string, buildPayload func(string) json.RawMessage, rows []modalRow, action *modalActionRow) *modalState {
	ms := &modalState{zone: zone, intent: intent, placeholder: placeholder, namePlaceholder: namePlaceholder, buildPayload: buildPayload, rows: rows, action: action, hoverRow: -1}
	ms.refilter()
	return ms
}

type repoPayload struct {
	Repo string `json:"repo"`
}

type checkoutPayload struct {
	Branch   string `json:"branch"`
	Strategy string `json:"strategy,omitempty"`
}

type checkoutNewPayload struct {
	New  bool   `json:"new"`
	From string `json:"from"`
	Name string `json:"name"`
}

type worktreePayload struct {
	Path string `json:"path"`
}

type worktreeNewPayload struct {
	New  bool   `json:"new"`
	Name string `json:"name"`
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
			text: label, label: label, badgeData: r.Badge,
			group: r.Group, current: r.Current, selectable: true, value: r.ID,
		}
	}
	return newModal(zoneRepo, "mission:repo", "filter repos", "", func(v string) json.RawMessage {
		return mustPayload(repoPayload{Repo: v})
	}, rows, nil)
}

// newBranchModal lists every branch, grouped default branch/recent/other/
// guarded (docs/design/mission/README.md's ratified GitHub-Desktop-parity
// sections, 2026-09-19; the driver computes the sections and dates,
// lib/mission/model.ts's buildBranchRows). A branch is guarded exactly when
// GuardedBy is non-empty (the Group label is a display hint the driver
// derives from the same fact, not the source of truth for it). A guarded
// row's own GuardedBy detail never renders on the row itself: the group
// header carries the reason instead (modalGroupHeaderText), so the row
// shows only its name and, on the right, the lock (modalRowLine). The
// current row keeps its ahead/behind pills (badgeData); every other row
// shows its own relative date (when) in that same slot instead.
func newBranchModal(m Model) *modalState {
	rows := make([]modalRow, len(m.Branches))
	for i, b := range m.Branches {
		guarded := b.GuardedBy != ""
		var badgeData Badge
		if !guarded && b.Current {
			badgeData = Badge{Ahead: b.Ahead, Behind: b.Behind}
		}
		rows[i] = modalRow{
			text: b.Name, label: b.Name, badgeData: badgeData, when: b.When,
			group: b.Group, current: b.Current, selectable: !guarded, guarded: guarded, value: b.Name,
		}
	}
	action := &modalActionRow{
		label: "New branch from " + m.Current.Branch + "…",
		buildPayload: func(name string) json.RawMessage {
			return mustPayload(checkoutNewPayload{New: true, From: m.Current.Branch, Name: name})
		},
	}
	return newModal(zoneBranch, "mission:checkout", "filter branches", "new branch name", func(v string) json.RawMessage {
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
			text: label, label: label, meta: meta, badgeData: w.Badge,
			current: w.Current, selectable: true, value: w.Path,
		}
	}
	action := &modalActionRow{
		label: "Provision new worktree…",
		buildPayload: func(name string) json.RawMessage {
			return mustPayload(worktreeNewPayload{New: true, Name: name})
		},
	}
	repoLabel := m.Current.RepoLabel
	if repoLabel == "" {
		repoLabel = m.Current.Repo
	}
	return newModal(zoneWorktree, "mission:worktree", "filter worktrees · "+repoLabel, "branch name for the new worktree", func(v string) json.RawMessage {
		return mustPayload(worktreePayload{Path: v})
	}, rows, action)
}

// renderAheadBehind is the same n↓/n↑ grammar the top bar's action pills use
// (topbar.go): Mint behind, Cyan ahead, either omitted at zero. It and
// renderBadge take the row's own bg (its cursor/hover fill, whichever is
// active) rather than a bare fg(): a badge renders at PAINT time now
// (modalRowLine), not at modal-construction time, precisely so its
// background always matches whatever the row is actually painted with --
// baking in a fixed background at construction would mismatch a cursor or
// hovered row's own SelBg/HoverBg fill.
func renderAheadBehind(bg lipgloss.Style, ahead, behind int) string {
	var parts []string
	if behind > 0 {
		parts = append(parts, bg.Foreground(theme.Mint).Render(fmt.Sprintf("%d↓", behind)))
	}
	if ahead > 0 {
		parts = append(parts, bg.Foreground(theme.Cyan).Render(fmt.Sprintf("%d↑", ahead)))
	}
	return strings.Join(parts, bg.Render(" "))
}

// renderBadge is a repo/worktree row's summary: a Peach dirty-file dot, the
// same ahead/behind pair renderAheadBehind renders for a branch, and a Mint
// check standing alone when there is nothing else to show and the row is
// actually clean.
func renderBadge(bg lipgloss.Style, b Badge) string {
	var parts []string
	if dirty := b.Staged + b.Unstaged + b.Untracked + b.Conflicted; dirty > 0 {
		parts = append(parts, bg.Foreground(theme.Peach).Render(fmt.Sprintf("●%d", dirty)))
	}
	if ab := renderAheadBehind(bg, b.Ahead, b.Behind); ab != "" {
		parts = append(parts, ab)
	}
	if len(parts) == 0 && b.Clean {
		parts = append(parts, bg.Foreground(theme.Mint).Render(theme.GlyphDone))
	}
	return strings.Join(parts, bg.Render(" "))
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
	m.focus = m.homeFocus()
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
	if ms.naming {
		switch v.String() {
		case "esc":
			ms.naming = false
			ms.nameInput.Blur()
			return m, nil
		case "enter":
			return m.commitModalName()
		}
		var cmd tea.Cmd
		ms.nameInput, cmd = ms.nameInput.Update(v)
		return m, cmd
	}
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

// selectModalAction opens the trailing action row's name field regardless of
// where the cursor sits: ctrl-n's own path, and the one enter takes when the
// cursor already sits on the action slot. A repo modal has no action row, so
// ctrl-n there is simply a no-op. Nothing is emitted here; commitModalName
// does that once a name exists.
func (m *Mission) selectModalAction() (tea.Model, tea.Cmd) {
	ms := m.modal
	if ms.action == nil || ms.naming {
		return m, nil
	}
	ms.naming = true
	ms.nameInput = newTextInput(ms.namePlaceholder, modalNameWidth(ms, m.width))
	return m, ms.nameInput.Focus()
}

// openBranchModalFrom is Create Branch from Commit: the branch foldout opens
// already naming, its new branch starting at sha. It skips openBranchModal's
// detached-HEAD refusal, since a commit is a starting point either way.
func (m *Mission) openBranchModalFrom(sha, short string) (tea.Model, tea.Cmd) {
	m.modal = newBranchModal(m.model)
	m.focus = focusModal
	m.modal.action.label = "New branch from " + short + "…"
	m.modal.action.buildPayload = func(name string) json.RawMessage {
		return mustPayload(checkoutNewPayload{New: true, From: sha, Name: name})
	}
	return m.selectModalAction()
}

// commitModalName emits the action row's intent with the typed name. A blank
// or whitespace-only name is inert, the same gate the commit button applies
// to its summary.
func (m *Mission) commitModalName() (tea.Model, tea.Cmd) {
	ms := m.modal
	name := strings.TrimSpace(ms.nameInput.Value())
	if name == "" {
		return m, nil
	}
	intent, payload := ms.intent, ms.action.buildPayload(name)
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

// segmentWidth mirrors renderTopBar's own column math (topbar.go): the
// column span the zone's own segment occupies in the bar, used as a floor
// for its modal's width so a foldout never renders narrower than the
// button that opened it (the owner's explicit ask for the repo modal: the
// same width as the repo button).
func segmentWidth(zone zoneID, width int) int {
	const dividers = 3
	remaining := width - sidebarWidth - dividers
	if remaining < 0 {
		remaining = 0
	}
	segW := remaining / 3
	lastW := remaining - segW*2
	switch zone {
	case zoneWorktree, zoneBranch:
		return segW
	case zoneAction:
		return lastW
	default:
		return sidebarWidth
	}
}

// modalWidth mirrors modalRowLine/modalActionLine's own fixed-column
// formulas exactly (bar + status + gap before the label, a space-led meta,
// a gap-led badge) so a row's label gets its full width rather than losing
// cells to a looser estimate here that undercounts those fixed columns. Its
// own content-driven sizing (modalContentMin..modalContentMax) is then
// floored by its anchor segment's width -- max(segment, content), per the
// width rule -- so the repo modal, whose segment spans the whole sidebar,
// renders exactly sidebarWidth wide.
func modalWidth(ms *modalState, frameWidth int) int {
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
		// Colorless here: lipgloss.Width ignores SGR either way, and the
		// badge's actual color depends on a row background this measuring
		// pass has no cursor/hover state to pick.
		badgeW := lipgloss.Width(renderBadge(lipgloss.NewStyle(), r.badgeData))
		if r.when != "" {
			badgeW = lipgloss.Width(r.when)
		}
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
	consider(1 + modalKeybarMaxPlainWidth(ms.zone))
	if need > modalContentMax {
		need = modalContentMax
	}
	if floor := segmentWidth(ms.zone, frameWidth) - 2; floor > need {
		need = floor
	}
	return need
}

// modalInnerWidth is the box's actual rendered content width: modalWidth's
// own content-driven sizing, clamped to the frame the box composites onto --
// the same clamp renderMissionModal applies before calling modalBoxLines.
// Anything that sizes content to fit the rendered box (modalNameWidth) must
// go through this, not modalWidth directly, or it disagrees with the box
// below the clamp boundary (a frame narrower than modalContentMax + 2).
func modalInnerWidth(ms *modalState, frameWidth int) int {
	inner := modalWidth(ms, frameWidth)
	if inner > frameWidth-2 {
		inner = frameWidth - 2
	}
	if inner < 1 {
		inner = 1
	}
	return inner
}

// modalNameWidth is the name field's own width: the filter line's text area,
// which is the box's content width less the chevron, its trailing space, and
// one more cell for the input's own cursor -- bubbles' textinput.SetWidth
// bounds the text/placeholder run only, and both its placeholderView and its
// end-of-line cursor path render one further cell for the cursor itself, so
// a field built at the full text-area width renders one cell wider than it.
func modalNameWidth(ms *modalState, frameWidth int) int {
	const cursorCell = 1
	prefixW := lipgloss.Width(theme.GlyphChevron) + 1
	w := modalInnerWidth(ms, frameWidth) - prefixW - cursorCell
	if w < 0 {
		return 0
	}
	return w
}

// modalFilterLine is the foldout's own fixed-height filter row
// (modalFixedRows reserves exactly 1 row for it above the scrollable
// region): query is user-typed and unbounded, so -- the same class of bug
// as the commit button (CodeRabbit, PR #353) -- it is clipped before
// Width() rather than left to wrap, mirroring changes.go's renderFilterRow.
//
// The name field deliberately reuses this line rather than adding one: an
// extra line would have to be mirrored by hand in modalHitTest, whose layout
// walk is a parallel copy of modalBoxLines, and any drift there misplaces
// every click in the modal.
func modalFilterLine(ms *modalState, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	prefixW := lipgloss.Width(theme.GlyphChevron) + 1
	textW := width - prefixW
	if textW < 0 {
		textW = 0
	}
	if ms.naming {
		// The input renders its own cursor and is already width-bounded by
		// SetWidth, so it is composed rather than clipped here.
		return bg.Width(width).Render(bg.Foreground(theme.Pink).Render(theme.GlyphChevron+" ") + ms.nameInput.View())
	}
	body, style := ms.placeholder, bg.Foreground(theme.Faint)
	if ms.query != "" {
		body, style = ms.query, bg.Foreground(theme.Text)
	}
	left := bg.Foreground(theme.Pink).Render(theme.GlyphChevron+" ") + style.Render(clip(body, textW))
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
	badge := renderBadge(bg, r.badgeData)
	if r.when != "" {
		badge = bg.Foreground(theme.Dimmer).Render(r.when)
	}
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
// draw -- the boards' own group-label convention. A repo's own Group value
// (repoGroup's "host/owner") is driver-supplied and unbounded, and
// modalWidth never accounts for header text when it sizes the box, so text
// is clipped before Width() -- the same class of bug as the commit button
// (CodeRabbit, PR #353): a wrapped header would occupy 2 physical rows
// where modalDisplayLines' scroll-viewport math assumes exactly 1.
func modalGroupHeaderLine(text string, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	textW := width - 1
	if textW < 0 {
		textW = 0
	}
	// clip, not clipOn: text carries no color of its own yet, and clipOn's
	// non-truncating path renders its input through a colorless style
	// (safe only when the input already carries its own embedded fg+bg per
	// fragment) -- passing plain text through it left a real background
	// hole here (caught by the bg-coverage frame tests).
	return bg.Width(width).Render(bg.Foreground(theme.Dimmer).Render(" " + clip(text, textW)))
}

// modalKeybarPairsFor lists a zone's wired key/label pairs, in display order:
// only what this modal actually dispatches, never the boards' unwired
// ctrl-f/ctrl-w/ctrl-d. While naming, enter and esc mean create/cancel
// instead of whatever the zone's own action row wires them to.
func modalKeybarPairsFor(zone zoneID, naming bool) [][2]string {
	if naming {
		return [][2]string{{"enter", "create"}, {"esc", "cancel"}}
	}
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

func modalKeybarPairs(ms *modalState) [][2]string {
	return modalKeybarPairsFor(ms.zone, ms.naming)
}

func modalKeybarPlainTextFor(zone zoneID, naming bool) string {
	pairs := modalKeybarPairsFor(zone, naming)
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = p[0] + " " + p[1]
	}
	return strings.Join(parts, " · ")
}

// modalKeybarMaxPlainWidth is the widest keybar text a zone can ever show,
// naming or not, so modalWidth sizes the box off a bound that does not
// shift when naming opens or closes (a ratified geometry invariant).
func modalKeybarMaxPlainWidth(zone zoneID) int {
	max := 0
	for _, naming := range []bool{false, true} {
		if w := lipgloss.Width(modalKeybarPlainTextFor(zone, naming)); w > max {
			max = w
		}
	}
	return max
}

// modalKeybarLine is the foldout's own keybar, inside the border: the same
// key/label/dot grammar the main keybar uses (changes.go's renderKeybar),
// painted on the box's own Surface background.
func modalKeybarLine(ms *modalState, width int) string {
	bg := lipgloss.NewStyle().Background(theme.Surface)
	dot := bg.Foreground(theme.Dim).Render(" · ")
	key := func(k, label string) string {
		return bg.Foreground(theme.KeybarKey).Bold(true).Render(k) + bg.Foreground(theme.KeybarLabel).Render(" "+label)
	}
	pairs := modalKeybarPairs(ms)
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = key(p[0], p[1])
	}
	left := bg.Render(" ") + clipOn(strings.Join(parts, dot), width-1, bg)
	return bg.Width(width).Render(left)
}

// modalFixedRows is the row count around the scrollable row region: the
// filter line and its rule above; the closing rule, keybar, and (when the
// kind has one) the action row and its own rule below.
func modalFixedRows(ms *modalState) (above, below int) {
	above = 2
	below = 2
	if ms.action != nil {
		below += 2
	}
	return above, below
}

// modalDisplayLine is one line of the scrollable row region: either a group
// header (display-only, never a cursor target) or a match row.
type modalDisplayLine struct {
	header   string
	matchIdx int
}

// modalDisplayLines flattens matches and their group headers into the
// sequence the row region actually paints, so the scroll viewport windows
// over real display lines (headers included) rather than re-deriving where
// headers fall inside whatever slice happens to be visible.
func modalDisplayLines(ms *modalState) []modalDisplayLine {
	if len(ms.matches) == 0 {
		return nil
	}
	lines := make([]modalDisplayLine, 0, len(ms.matches))
	for i := range ms.matches {
		if text := modalHeaderBefore(ms, i); text != "" {
			lines = append(lines, modalDisplayLine{header: text})
		}
		lines = append(lines, modalDisplayLine{matchIdx: i})
	}
	return lines
}

// modalRowViewport resolves the row region's [top, top+h) window with the
// shared picker.Viewport primitive -- the same one the diff pane and
// Changes list use -- keeping the cursor's own display line visible.
func modalRowViewport(ms *modalState, lines []modalDisplayLine, rowRegionH, prevTop int) (top, h int) {
	cursorLine := 0
	for i, l := range lines {
		if l.header == "" && l.matchIdx == ms.cursor {
			cursorLine = i
			break
		}
	}
	return picker.Viewport(cursorLine, prevTop, len(lines), rowRegionH, rowRegionH, 0)
}

func modalSurfaceFillRows(width, n int) []string {
	if n <= 0 {
		return nil
	}
	row := lipgloss.NewStyle().Width(width).Background(theme.Surface).Render("")
	rows := make([]string, n)
	for i := range rows {
		rows[i] = row
	}
	return rows
}

func modalThumbCell(rowInWindow, thumbTop, thumbH int) string {
	return picker.ThumbCell(rowInWindow, thumbTop, thumbH,
		lipgloss.NewStyle().Background(theme.Panel), lipgloss.NewStyle().Background(theme.Surface))
}

// modalBoxLines lays out the foldout's full content at a FIXED height
// (boxInnerHeight): the filter line and its rule, the scrollable row
// region -- always exactly rowRegionH rows, a short list top-aligned with
// Surface filler below it, a long list scrolling with the cursor and a
// Panel thumb -- then the pinned bottom block (the action row when the
// kind has one, the closing rule, and this foldout's own keybar).
// GitHub Desktop's own dropdowns run to the window bottom and own that
// space; docs/design/mission/README.md's ratified-deviations entry records
// this superseding the boards' content-height drawing.
func modalBoxLines(ms *modalState, width, boxInnerHeight int) []string {
	above, below := modalFixedRows(ms)
	rowRegionH := boxInnerHeight - above - below
	if rowRegionH < 0 {
		rowRegionH = 0
	}

	lines := []string{modalFilterLine(ms, width), modalRuleLine(width)}

	displayLines := modalDisplayLines(ms)
	switch {
	case len(displayLines) == 0:
		lines = append(lines, modalNoMatchLine(width))
		lines = append(lines, modalSurfaceFillRows(width, rowRegionH-1)...)
	default:
		top, h := modalRowViewport(ms, displayLines, rowRegionH, ms.scrollTop)
		ms.scrollTop = top
		scrolling := len(displayLines) > h
		rowWidth := width
		if scrolling {
			rowWidth--
		}
		thumbTop, thumbH := picker.ThumbSpan(top, h, len(displayLines))
		for i := top; i < top+h; i++ {
			dl := displayLines[i]
			var row string
			if dl.header != "" {
				row = modalGroupHeaderLine(dl.header, rowWidth)
			} else {
				row = modalRowLine(ms.rows[ms.matches[dl.matchIdx].Index], rowWidth, dl.matchIdx == ms.cursor && !ms.naming, dl.matchIdx == ms.hoverRow)
			}
			if scrolling {
				row += modalThumbCell(i-top, thumbTop, thumbH)
			}
			lines = append(lines, row)
		}
		lines = append(lines, modalSurfaceFillRows(width, rowRegionH-h)...)
	}

	if ms.action != nil {
		lines = append(lines, modalRuleLine(width))
		lines = append(lines, modalActionLine(ms.action, width, ms.onActionSlot(), ms.hoverAction))
	}
	lines = append(lines, modalRuleLine(width))
	lines = append(lines, modalKeybarLine(ms, width))
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
// place (picker.DimForeground), the box lands as a layer anchored under its
// segment, clamped so it never runs past the pane -- the picker's own
// overlay idiom (picker.Menu's Render).
// renderMissionModal composites ms's box at FULL frame height: its top edge
// sits on the anchor row below the top bar (as before), its bottom edge is
// the frame's own last row -- GitHub Desktop's dropdowns run to the window
// bottom and own that space, covering whatever sits below them (the main
// keybar) for as long as they're open. That is intended, not a bug.
func renderMissionModal(parent string, ms *modalState, width, height, topBarHeight int) string {
	dimmed := picker.DimForeground(parent)
	inner := modalInnerWidth(ms, width)
	boxInnerHeight := height - topBarHeight - 2 // -2 for the box's own top/bottom border
	if boxInnerHeight < 1 {
		boxInnerHeight = 1
	}
	box := modalBoxFrame(modalBoxLines(ms, inner, boxInnerHeight))

	x := clampX(segmentOrigin(ms.zone, width), lipgloss.Width(box), width)
	y := topBarHeight

	parentLayer := lipgloss.NewLayer(dimmed).X(0).Y(0).Z(0)
	modalLayer := lipgloss.NewLayer(box).X(x).Y(y).Z(1)
	return lipgloss.NewCompositor(parentLayer, modalLayer).Render()
}

// renderNoticeStrip is the one-line refusal banner at the frame's bottom.
// It paints whichever notice noticeText (mission.go) resolved: the wire
// Model's own Notice (a driver refusal) or the view-local one -- both
// free-form and unbounded. The strip is a fixed single row the frame's own
// layout budgets exactly 1 row for (layout's noticeH), so text is clipped
// before Width() -- the same class of bug as the commit button (CodeRabbit,
// PR #353): an unclipped long notice would wrap and desync every row below it.
func renderNoticeStrip(text string, width int) string {
	if width <= 0 {
		return ""
	}
	on := lipgloss.NewStyle().Background(theme.WarnBg)
	fg := on.Foreground(theme.Peach)
	// Clip the WHOLE payload (glyph + gap + text), not just text: clipping
	// only text left the fixed chrome around it (leading space + glyph +
	// gap, 3 cells) unaccounted for, so at width 1-2 it alone still
	// exceeded width and could wrap (CodeRabbit, PR #353).
	left := fg.Render(clip(theme.GlyphWarn+" "+text, width-1))
	return on.Width(width).Render(" " + left)
}
