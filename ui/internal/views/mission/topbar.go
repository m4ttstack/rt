// Top bar: the repo / worktree / branch / adaptive-action segment row that
// sits above the changes and diff panes. Every render function here is pure
// (Model + geometry in, a string out); no segment holds state of its own.
package mission

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// zoneID names a hoverable/clickable region of the mission view. Hover and
// foldout wiring land in a later task; this task only threads the values
// through renderTopBar so the plumbing shape does not change later.
type zoneID int

const (
	zoneNone zoneID = iota
	zoneRepo
	zoneWorktree
	zoneBranch
	zoneAction
)

// sidebarWidth is the locked width the repo segment shares with the changes
// sidebar (docs/design/mission/README.md: "the repository segment and the
// changes sidebar share one locked width").
const sidebarWidth = 46

func fg(c color.Color) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(c)
}

// renderTopBar lays out the four segments left to right: repo at the locked
// sidebarWidth, worktree and branch splitting the remainder evenly, and the
// action segment absorbing whatever is left over (it is the one segment
// whose content genuinely varies in length across states).
func renderTopBar(m Model, width int, hover, open zoneID) string {
	if width <= 0 {
		return ""
	}
	const dividers = 3
	remaining := width - sidebarWidth - dividers
	if remaining < 0 {
		remaining = 0
	}
	segW := remaining / 3
	lastW := remaining - segW*2

	repo := renderRepoSegment(m, sidebarWidth, hover == zoneRepo, open == zoneRepo)
	worktree := renderWorktreeSegment(m, segW, hover == zoneWorktree, open == zoneWorktree)
	branch := renderBranchSegment(m, segW, hover == zoneBranch, open == zoneBranch)
	action := renderActionSegment(m.Action, lastW, hover == zoneAction, open == zoneAction)

	div := fg(theme.Rule).Render("│") + "\n" + fg(theme.Rule).Render("│")
	return lipgloss.JoinHorizontal(lipgloss.Top, repo, div, worktree, div, branch, div, action)
}

// segmentSpec is the shared shape every top-bar segment reduces to: an icon,
// a two-line label/value (or title/meta) block, and an optional trailing
// accessory (a chevron or a set of pills) already rendered to its final
// color.
type segmentSpec struct {
	icon        string
	iconColor   color.Color
	top         string
	topColor    color.Color
	topBold     bool
	bottom      string
	bottomColor color.Color
	bottomBold  bool
	trailing    string
}

func renderRepoSegment(m Model, width int, hovered, isOpen bool) string {
	label := m.Current.RepoLabel
	if label == "" {
		label = m.Current.Repo
	}
	return renderSegment(width, segmentSpec{
		icon:        "◪",
		iconColor:   theme.Dimmer,
		top:         "Current Repository",
		topColor:    theme.Dimmer,
		bottom:      label,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    fg(theme.Dimmer).Render(theme.GlyphChevron),
	}, hovered, isOpen)
}

func renderWorktreeSegment(m Model, width int, hovered, isOpen bool) string {
	name := m.Current.WorktreeName
	if name == "" {
		name = m.Current.Worktree
	}
	return renderSegment(width, segmentSpec{
		icon:        "◉",
		iconColor:   theme.Dimmer,
		top:         "Current Worktree",
		topColor:    theme.Dimmer,
		bottom:      name,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    fg(theme.Dimmer).Render(theme.GlyphChevron),
	}, hovered, isOpen)
}

// renderBranchSegment renders the normal (a branch name with a foldout
// chevron) and detached (an "On <sha>" value in Peach, no foldout) states.
// The checking-out spinner state lands with the interaction wiring pass.
func renderBranchSegment(m Model, width int, hovered, isOpen bool) string {
	if m.Current.Detached {
		return renderSegment(width, segmentSpec{
			icon:        "○",
			iconColor:   theme.Peach,
			top:         "Detached HEAD",
			topColor:    theme.Dimmer,
			bottom:      "On " + m.Current.Branch,
			bottomColor: theme.Peach,
			bottomBold:  true,
		}, hovered, isOpen)
	}
	return renderSegment(width, segmentSpec{
		icon:        "●",
		iconColor:   theme.Dimmer,
		top:         "Current Branch",
		topColor:    theme.Dimmer,
		bottom:      m.Current.Branch,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    fg(theme.Dimmer).Render(theme.GlyphChevron),
	}, hovered, isOpen)
}

// renderActionSegment renders the adaptive action segment: an icon keyed off
// Kind (replaced by a spinner frame while Busy), a bold title over a dimmer
// meta line, and ahead/behind pills that only appear when their count is
// nonzero (GitHub Desktop's badge rule: a diverged repo shows both counts on
// the one Pull button, never a combined pull-then-push state).
func renderActionSegment(a ActionModel, width int, hovered, isOpen bool) string {
	icon, col := actionGlyph(a)
	var pills []string
	if a.Behind > 0 {
		pills = append(pills, pill(fmt.Sprintf("%d↓", a.Behind), theme.Mint))
	}
	if a.Ahead > 0 {
		pills = append(pills, pill(fmt.Sprintf("%d↑", a.Ahead), theme.Cyan))
	}
	return renderSegment(width, segmentSpec{
		icon:        icon,
		iconColor:   col,
		top:         a.Title,
		topColor:    theme.Text,
		topBold:     true,
		bottom:      a.Meta,
		bottomColor: theme.Dimmer,
		trailing:    strings.Join(pills, " "),
	}, hovered, isOpen)
}

// actionGlyph maps an action Kind to its icon and accent color. Fetch and any
// unrecognized kind fall through to the same PinkSoft ⟳ default. Busy
// replaces whatever icon the Kind would show with a spinner frame, keeping
// the accent color so the segment does not change hue mid-run.
func actionGlyph(a ActionModel) (string, color.Color) {
	icon, col := "⟳", theme.PinkSoft
	switch a.Kind {
	case "pull", "pull-rebase":
		icon, col = "↓", theme.Mint
	case "push":
		icon, col = "↑", theme.Cyan
	case "force-push":
		icon, col = "⇈", theme.Coral
	case "publish-branch", "publish-repo":
		icon, col = "↑", theme.Lav
	}
	if a.Busy {
		icon = theme.SpinnerFrames[0]
	}
	return icon, col
}

func pill(text string, col color.Color) string {
	return lipgloss.NewStyle().Foreground(col).Background(theme.Panel).Padding(0, 1).Render(text)
}

// renderSegment lays spec out as a fixed-width, two-row block: the icon
// leads the bottom row with the top row indented to match, and an optional
// trailing accessory (chevron or pills) sits flush right on the bottom row.
// Both rows are padded with the segment's background (Surface when open,
// HoverBg when hovered, transparent at rest) so the fill reads as one
// segment rather than text floating on the bar's own background.
func renderSegment(width int, spec segmentSpec, hovered, isOpen bool) string {
	if width < 0 {
		width = 0
	}
	base := lipgloss.NewStyle()
	switch {
	case isOpen:
		base = base.Background(theme.Surface)
	case hovered:
		base = base.Background(theme.HoverBg)
	}

	iconW := lipgloss.Width(spec.icon)
	prefixW := 1 + iconW + 2 // leading space + icon column + gap

	topAvail := width - prefixW
	if topAvail < 0 {
		topAvail = 0
	}
	top := base.Foreground(spec.topColor).Bold(spec.topBold).Render(clip(spec.top, topAvail))
	row1 := base.Render(" "+strings.Repeat(" ", iconW)+"  ") + top
	row1 = base.Width(width).Render(row1)

	trailW := lipgloss.Width(spec.trailing)
	bottomAvail := width - prefixW - trailW
	if trailW > 0 {
		bottomAvail-- // gap before the trailing accessory
	}
	if bottomAvail < 0 {
		bottomAvail = 0
	}
	icon := base.Foreground(spec.iconColor).Render(spec.icon)
	value := base.Foreground(spec.bottomColor).Bold(spec.bottomBold).Render(clip(spec.bottom, bottomAvail))
	row2 := base.Render(" ") + icon + base.Render("  ") + value
	if spec.trailing != "" {
		gap := width - lipgloss.Width(row2) - trailW - 1
		if gap < 0 {
			gap = 0
		}
		row2 += base.Render(strings.Repeat(" ", gap)+" ") + spec.trailing
	}
	row2 = base.Width(width).Render(row2)

	return row1 + "\n" + row2
}

// clip truncates already-rendered (possibly ANSI-colored) text to w cells,
// appending an ellipsis when it had to cut anything. Mirrors the board
// view's clip (render.go): a one-cell window has no room beside the marker,
// so it is the whole cell.
func clip(s string, w int) string {
	if w >= 1 && lipgloss.Width(s) > w {
		if w == 1 {
			return "…"
		}
		return lipgloss.NewStyle().Inline(true).MaxWidth(w-1).Render(s) + "…"
	}
	return lipgloss.NewStyle().Inline(true).MaxWidth(w).Render(s)
}
