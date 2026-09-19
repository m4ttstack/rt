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

	divCell := lipgloss.NewStyle().Background(theme.BgSubtle).Foreground(theme.Rule).Render("│")
	div := divCell + "\n" + divCell
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
		icon:        theme.GlyphRepo,
		iconColor:   theme.Dimmer,
		top:         "Current Repository",
		topColor:    theme.Dimmer,
		bottom:      label,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    segmentBase(hovered, isOpen).Foreground(theme.Dimmer).Render(theme.GlyphChevron),
	}, hovered, isOpen)
}

func renderWorktreeSegment(m Model, width int, hovered, isOpen bool) string {
	name := m.Current.WorktreeName
	if name == "" {
		name = m.Current.Worktree
	}
	return renderSegment(width, segmentSpec{
		icon:        theme.GlyphWorktree,
		iconColor:   theme.Dimmer,
		top:         "Current Worktree",
		topColor:    theme.Dimmer,
		bottom:      name,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    segmentBase(hovered, isOpen).Foreground(theme.Dimmer).Render(theme.GlyphChevron),
	}, hovered, isOpen)
}

// renderBranchSegment renders the normal (a branch name with a foldout
// chevron) and detached (an "On <sha>" value in Peach, no foldout) states.
// The checking-out spinner state lands with the interaction wiring pass.
func renderBranchSegment(m Model, width int, hovered, isOpen bool) string {
	if m.Current.Detached {
		return renderSegment(width, segmentSpec{
			icon:        theme.GlyphBranch,
			iconColor:   theme.Peach,
			top:         "Detached HEAD",
			topColor:    theme.Dimmer,
			bottom:      "On " + m.Current.Branch,
			bottomColor: theme.Peach,
			bottomBold:  true,
		}, hovered, isOpen)
	}
	return renderSegment(width, segmentSpec{
		icon:        theme.GlyphBranch,
		iconColor:   theme.Dimmer,
		top:         "Current Branch",
		topColor:    theme.Dimmer,
		bottom:      m.Current.Branch,
		bottomColor: theme.Text,
		bottomBold:  true,
		trailing:    segmentBase(hovered, isOpen).Foreground(theme.Dimmer).Render(theme.GlyphChevron),
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
		// Each pill carries its own Panel background (pill()); only the
		// separator between them needs the segment's own band so it doesn't
		// leave a bare, unstyled gap.
		trailing: strings.Join(pills, segmentBase(hovered, isOpen).Render(" ")),
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

// segmentBase is the background every fragment of a top-bar segment
// paints: BgSubtle at rest, Surface once open, HoverBg while hovered.
// renderSegment uses it for its own two rows, and each segment function
// uses the SAME call (same hovered/isOpen) to color its pre-rendered
// trailing accessory (a chevron, or the separator between pills) before
// handing it to renderSegment -- otherwise that accessory renders through
// the bare fg() helper and carries no background of its own.
func segmentBase(hovered, isOpen bool) lipgloss.Style {
	base := lipgloss.NewStyle().Background(theme.BgSubtle)
	switch {
	case isOpen:
		return base.Background(theme.Surface)
	case hovered:
		return base.Background(theme.HoverBg)
	}
	return base
}

// renderSegment lays spec out as a fixed-width, two-row block: the icon
// leads the bottom row with the top row indented to match, and an optional
// trailing accessory (chevron or pills) sits flush right on the bottom row.
// Both rows are painted with the segment's own background (segmentBase) so
// the fill reads as one segment rather than text floating on the bar.
func renderSegment(width int, spec segmentSpec, hovered, isOpen bool) string {
	if width < 0 {
		width = 0
	}
	base := segmentBase(hovered, isOpen)

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
	// MaxWidth(0) does not truncate in lipgloss v2.0.6 (it no-ops on a
	// non-positive budget), so a zero/negative w must short-circuit here
	// rather than fall through to Render(s) below.
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) > w {
		if w == 1 {
			return "…"
		}
		return lipgloss.NewStyle().Inline(true).MaxWidth(w-1).Render(s) + "…"
	}
	return lipgloss.NewStyle().Inline(true).MaxWidth(w).Render(s)
}

// clipOn mirrors clip but paints its ellipsis with on rather than leaving it
// bare. clip's other callers feed it plain text that a further Render call
// colors afterward, so a bare "…" there ends up styled anyway; a caller
// that instead feeds clip an already-styled ANSI string (composing several
// pre-colored fragments, then clipping the result) gets a truncation that
// lipgloss ends on a reset, and a bare "…" after that reset falls through
// to the terminal's own default instead of the row's own fill.
func clipOn(s string, w int, on lipgloss.Style) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) > w {
		if w == 1 {
			return on.Render("…")
		}
		return lipgloss.NewStyle().Inline(true).MaxWidth(w-1).Render(s) + on.Render("…")
	}
	return lipgloss.NewStyle().Inline(true).MaxWidth(w).Render(s)
}
