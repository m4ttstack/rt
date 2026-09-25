package picker

import "charm.land/lipgloss/v2"

// defaultCap is the viewport height used when a caller sets no cap (cap_==0):
// enough rows to read as a real list without a short pane's chrome ever
// getting squeezed off a typical terminal.
const defaultCap = 14

// scrolloff mirrors vim's: the cursor stays this many rows from the visible
// top/bottom edge whenever the window is tall enough to afford it.
const scrolloff = 2

// scrollMargin shrinks scrolloff symmetrically once a window is too short to
// afford it on both edges at once -- shared by placeTop (keyboard/cursor
// scrolling) and mouse.go's wheel handler, which has to predict this same
// margin to know whether a wheel-scrolled top will hold on the next render
// or get immediately overridden by placeTop re-centering on the cursor.
func scrollMargin(h int) int {
	return marginWithin(h, scrolloff)
}

// marginWithin is want rows of margin, shrunk to what an h-row window can
// hold on both edges at once.
func marginWithin(h, want int) int {
	off := max(want, 0)
	if lim := (h - 1) / 2; lim < off {
		off = lim
	}
	return off
}

// Viewport returns [top, top+h) given cursor, list length, caller cap, pane
// rows, chrome rows. The pane is always the hard ceiling on h: a caller cap
// or a long list can ask for more rows than the terminal actually has, and
// the picker must fit inside the pane rather than paint rows the terminal
// will just truncate or scroll away from under it.
func Viewport(cursor, top, n, cap_, paneRows, chromeRows int) (newTop, h int) {
	return ViewportAround(cursor, top, n, cap_, paneRows, chromeRows, scrolloff, scrolloff)
}

// ViewportAround is Viewport with the cursor's margins set by the caller:
// before rows stay in view above the cursor row and after rows below it,
// each shrinking on a short window exactly as scrolloff does. Both are
// capped at (h-1)/2, so after cannot hold a multi-row block taller than that.
func ViewportAround(cursor, top, n, cap_, paneRows, chromeRows, before, after int) (newTop, h int) {
	if cap_ <= 0 {
		cap_ = defaultCap
	}
	h = cap_
	if n < h {
		h = n
	}
	if ceiling := paneRows - chromeRows; ceiling < h {
		h = ceiling
	}
	if h < 0 {
		h = 0
	}
	if h == 0 || n == 0 {
		return 0, h
	}
	return placeTopAround(cursor, top, n, h, before, after), h
}

// placeTop positions a window's top edge for an already-decided height h so
// the cursor keeps scrolloff rows of margin from both visible edges
// wherever h affords it, shrinking that margin symmetrically only when h is
// too short to hold scrolloff on both sides at once. Factored out of
// Viewport so a caller that needs to try several candidate heights (the
// header budget trim shrinks h to make room for header lines) can re-derive
// a scrolloff-correct top for each candidate instead of inheriting whatever
// top Viewport happened to compute for its own, larger h.
func placeTop(cursor, prevTop, n, h int) int {
	return placeTopAround(cursor, prevTop, n, h, scrolloff, scrolloff)
}

// placeTopAround is placeTop with the margin above and below the cursor
// given separately, each shrunk by marginWithin.
func placeTopAround(cursor, prevTop, n, h, before, after int) int {
	if h <= 0 || n <= 0 {
		return 0
	}
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= n {
		cursor = n - 1
	}

	maxTop := n - h
	if maxTop < 0 {
		maxTop = 0
	}
	top := prevTop
	if top < 0 {
		top = 0
	}
	if top > maxTop {
		top = maxTop
	}

	above, below := marginWithin(h, before), marginWithin(h, after)

	switch pos := cursor - top; {
	case pos < above:
		top = cursor - above
	case pos > h-1-below:
		top = cursor - (h - 1 - below)
	}
	if top < 0 {
		top = 0
	}
	if top > maxTop {
		top = maxTop
	}
	return top
}

// ThumbSpan sizes a scroll rail to the visible fraction of the list
// (h*h/n, floored, minimum one row so a long list always shows something to
// grab) and positions it in lockstep with the scroll offset. Shared by every
// scrolling region in the TUI (this package's own list, the diff pane, the
// mission foldouts) so there is one thumb-sizing formula, not a copy per
// view.
func ThumbSpan(top, h, n int) (thumbTop, thumbH int) {
	if n <= 0 || h <= 0 {
		return 0, 0
	}
	thumbH = h * h / n
	if thumbH < 1 {
		thumbH = 1
	}
	if thumbH > h {
		thumbH = h
	}
	maxTop := n - h
	if maxTop <= 0 {
		return 0, thumbH
	}
	avail := h - thumbH
	if avail < 0 {
		avail = 0
	}
	thumbTop = top * avail / maxTop
	return thumbTop, thumbH
}

// ThumbCell paints one row of a scroll rail: thumbStyle across the thumb's
// own span, restStyle everywhere else in the gutter -- callers supply both
// since each view's own background differs (the picker paints inline at the
// terminal default, the diff pane and mission's modals paint an explicit
// Bg/Surface).
func ThumbCell(rowInWindow, thumbTop, thumbH int, thumbStyle, restStyle lipgloss.Style) string {
	if rowInWindow >= thumbTop && rowInWindow < thumbTop+thumbH {
		return thumbStyle.Render(" ")
	}
	return restStyle.Render(" ")
}
