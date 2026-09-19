package testutil

import (
	"image/color"
	"io"
	"strings"

	uv "github.com/charmbracelet/ultraviolet"
	"github.com/charmbracelet/x/vt"
)

// ptyRows/ptyCols mirror RunPTY's own pty size (ptyrun.go, session.go).
const (
	ptyRows = 30
	ptyCols = 100
)

// withEmulator replays raw tty bytes through a width x height terminal
// emulator and hands it to fn before draining and closing it -- the setup
// Screen, CellBackground, and TerminalBackground all share. width/height
// need not match the pty's own 100x30: sizing the emulator LARGER lets a
// caller inspect a region the app never drew a single cell into, the same
// as an oversized real terminal pane would show around a smaller frame.
func withEmulator(tty string, width, height int, fn func(*vt.Emulator)) {
	em := vt.NewEmulator(width, height)
	// The emulator answers terminal queries (DECRQM and friends) on its own
	// reader, and rt-ui's frames carry those queries. With nobody draining it,
	// the first reply blocks Write forever.
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		_, _ = io.Copy(io.Discard, em)
	}()
	em.Write([]byte(tty))
	fn(em)
	em.Close()
	<-drained
}

// Screen replays raw tty bytes through a terminal emulator sized like RunPTY's
// pty and returns the visible text, trailing whitespace trimmed per line.
func Screen(tty string) string {
	var out string
	withEmulator(tty, ptyCols, ptyRows, func(em *vt.Emulator) { out = em.String() })

	lines := strings.Split(out, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}

// cellBackgroundIn replays tty into a width x height emulator and resolves
// cell (x, y)'s effective background the way a real terminal paints it:
// Emulator.Draw fills gaps -- a cell the renderer never explicitly styled,
// or one entirely outside the app's own drawn area when width/height exceed
// the pty's own size -- with the terminal's own registered default
// (TerminalBackground) before laying the touched cells on top. A raw ANSI
// scan of the ttyBuf can't reproduce either case: bubbletea's renderer is
// free to erase a run of styled trailing blanks down to a bare
// erase-to-end-of-line control code, and a region the app never wrote to
// has no bytes in the stream at all.
func cellBackgroundIn(tty string, width, height, x, y int) color.Color {
	var bg color.Color
	withEmulator(tty, width, height, func(em *vt.Emulator) {
		buf := uv.NewScreenBuffer(width, height)
		em.Draw(buf, uv.Rect(0, 0, width, height))
		if c := buf.CellAt(x, y); c != nil {
			bg = c.Style.Bg
		}
	})
	return bg
}

// CellBackground is cellBackgroundIn at the pty's own 100x30 size.
func CellBackground(tty string, x, y int) color.Color {
	return cellBackgroundIn(tty, ptyCols, ptyRows, x, y)
}

// CellBackgroundBeyondPTY replays tty into an emulator taller than the pty's
// own 30 rows and resolves a cell in the extra region -- one the app never
// wrote a single byte for, the way an oversized real terminal pane around a
// smaller frame would show. y must be >= ptyRows.
func CellBackgroundBeyondPTY(tty string, x, y int) color.Color {
	return cellBackgroundIn(tty, ptyCols, y+1, x, y)
}

// TerminalBackground replays tty and returns the terminal's own registered
// default background (set via an OSC 11 sequence, e.g. tea.View.
// BackgroundColor), or nil if the program never sent one.
func TerminalBackground(tty string) color.Color {
	var bg color.Color
	withEmulator(tty, ptyCols, ptyRows, func(em *vt.Emulator) { bg = em.BackgroundColor() })
	return bg
}
