package picker

import "testing"

// TestViewportAroundKeepsEachMargin walks a cursor through a long list both
// ways, feeding each top back in: the window keeps before rows above the
// cursor and after rows below it, or the list's end when fewer remain.
func TestViewportAroundKeepsEachMargin(t *testing.T) {
	const n, h, before, after = 100, 20, 6, 8
	for _, dir := range []int{1, -1} {
		cursor, top := 0, 0
		if dir < 0 {
			cursor, top = n-1, n-h
		}
		for range n {
			var vis int
			top, vis = ViewportAround(cursor, top, n, h, h, 0, before, after)
			if vis != h {
				t.Fatalf("a %d-row list in a %d-row pane should fill it, got %d", n, h, vis)
			}
			if got, want := cursor-top, min(before, cursor); got < want {
				t.Fatalf("dir %d cursor %d top %d: %d rows above the cursor, want at least %d", dir, cursor, top, got, want)
			}
			if got, want := top+h-1-cursor, min(after, n-1-cursor); got < want {
				t.Fatalf("dir %d cursor %d top %d: %d rows below the cursor, want at least %d", dir, cursor, top, got, want)
			}
			cursor += dir
		}
	}
}

// TestViewportAroundShrinksMarginsOnAShortWindow: like scrolloff, each
// margin gives way to (h-1)/2 once the window cannot afford it, so a 7-row
// window holds a cursor with margins 6 and 8 on its middle row.
func TestViewportAroundShrinksMarginsOnAShortWindow(t *testing.T) {
	const n, h = 50, 7
	top := 0
	for cursor := range n {
		top, _ = ViewportAround(cursor, top, n, h, h, 0, 6, 8)
		if cursor >= 3 && cursor <= n-4 && cursor-top != 3 {
			t.Fatalf("cursor %d should sit on the middle row, top %d", cursor, top)
		}
	}
}
