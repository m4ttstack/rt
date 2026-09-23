package picker

import (
	"encoding/json"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
)

// modalKind distinguishes the overlay's two mechanisms: a registry menu
// (ctrl-k / right-click) dispatches its chosen row through the same
// event/result paths a pressed key would, entirely locally; a TS-driven
// modal answers with a modal-result line and never dispatches anything
// itself.
type modalKind int

const (
	modalRegistry modalKind = iota
	modalTSDriven
)

// modalState is the picker's overlay: opened by ctrl-k/right-click (a
// registry menu, rendered from data the model already holds) or by a
// PickModal message (TS-driven), and closed either by a selection or by
// esc/click-outside. The parent picker underneath is never torn down while
// it's open.
type modalState struct {
	kind modalKind
	*Menu
}

// menuCursorRow reports which visible row ctrl-k/right-click should act on,
// in the form deriveMenu expects (-1 for "no row" -- an empty list).
func (m *Model) menuCursorRow() int {
	if m.cursor < 0 || m.cursor >= len(m.matches) {
		return -1
	}
	return m.cursor
}

// composeFrame is renderView's own composition step before any height
// padding: the plain list, composited under the modal overlay when one is
// open. Kept separate from renderView so pinFrameHeight can measure a
// frame's own natural height without measuring back through padding an
// earlier call already applied.
func composeFrame(m *Model) string {
	body := render(m)
	if m.modal != nil && body != "" {
		body = m.modal.Render(body, m.width)
	}
	return body
}

// padToHeight appends blank TRAILING lines until body reaches target lines.
// renderView reaches the reserved floor with renderFrame's interior filler
// (the keybar stays the last visible line); this only fires for the pin's
// extra height (pinnedHeight above the floor, hosting a wire modal taller than
// the list and held through its close), where trailing blanks are wanted --
// clearBottom strips them off screen, so bubbletea's frame line count holds
// across the close without the visible frame inflating once the overlay is
// gone. target <= body's height leaves body unpadded.
func padToHeight(body string, target int) string {
	if target <= 0 || body == "" {
		return body
	}
	if h := lipgloss.Height(body); h < target {
		body += strings.Repeat("\n", target-h)
	}
	return body
}

// reservedContentHeight is the session floor renderView pads to from the
// first paint: the row cap (the visible-row ceiling, past which the list
// scrolls), the tallest chrome the session can show, room for the group
// headers the cap never counted, and never past the pane. A frame padded to
// this never grows or shrinks as the query narrows, a descend swaps the rows,
// or ctrl-t toggles hidden files, so none of those re-enter the inline
// grow/shrink diff pinFrameHeight guards for.
func (m *Model) reservedContentHeight() int {
	rowCap := m.req.Cap
	if rowCap <= 0 {
		rowCap = defaultCap
	}
	// A multi session can reveal the selected panel; reserve its line so
	// checking a row never grows the frame.
	chrome := chromeRows
	if isMultiRequest(m.req) {
		chrome++
	}
	// Grouped matches render contiguous (GroupContiguous partitions them after
	// Rank), so the whole list carries one header per group and any window shows
	// at most distinctGroupCount of them. Reserve that many header lines so a
	// typed query narrowing the list never crosses the floor.
	headers := distinctGroupCount(m.req.Rows)
	reserved := chrome + rowCap + headers
	if o := m.registryMenuHeight(); o > reserved {
		reserved = o
	}
	if m.height > 0 && reserved > m.height {
		reserved = m.height
	}
	return reserved
}

// registryMenuHeight is the height a ctrl-k / right-click overlay derived
// from this request's declared actions would occupy, so the reserved frame
// is tall enough to host it without the base list growing when it opens.
func (m *Model) registryMenuHeight() int {
	rows := deriveMenu(m.req.Actions, 0)
	if len(rows) == 0 {
		return 0
	}
	return NewMenu("", menuItemsFromRegistry(rows), nil).BoxHeight(m.width)
}

// setReserved re-derives the floor from the current pane, dropping it when a
// resize shrinks the terminal (a resize is a full repaint, not the inline
// diff the floor exists to avoid). pinnedHeight tracks the floor up, and back
// down only when a shrunk pane leaves it taller than the terminal.
func (m *Model) setReserved() {
	m.reservedHeight = m.reservedContentHeight()
	if m.pinnedHeight < m.reservedHeight {
		m.pinnedHeight = m.reservedHeight
	}
	if m.height > 0 && m.pinnedHeight > m.height {
		m.pinnedHeight = m.reservedHeight
	}
}

// raiseReserved lifts the floor to cover a live row swap that needs more room
// (more groups, a breadcrumb the request gained) without ever lowering it
// within a fixed pane, so a descend into a shorter directory never shrinks
// the frame back.
func (m *Model) raiseReserved() {
	if r := m.reservedContentHeight(); r > m.reservedHeight {
		m.reservedHeight = r
	}
	if m.pinnedHeight < m.reservedHeight {
		m.pinnedHeight = m.reservedHeight
	}
}

// distinctGroupCount counts the distinct non-empty group labels across the
// rows. Since grouped matches render contiguous, this is exactly how many
// headers the whole list carries, and so the most any window can show -- the
// header room reservedContentHeight budgets.
func distinctGroupCount(rows []protocol.PickRow) int {
	seen := make(map[string]bool)
	for _, r := range rows {
		if r.Group != "" {
			seen[r.Group] = true
		}
	}
	return len(seen)
}

// pinFrameHeight raises the pad target to host an overlay taller than the
// session floor, so that overlay's own open and close repaint whole
// (armPinRelease holds the raise through the close's clearScreenMsg) rather
// than diffing across its grow and shrink. It never lowers the target; a
// shorter overlay opening over a taller floor changes nothing.
//
// The height this holds steady is exactly what bubbletea's own inline
// renderer treats as a "grow" or "shrink" transition -- entering that path
// is what the terminal's own idea of an ambiguous-width glyph's column
// cost (❯, ◉) can disagree with this renderer's own, slipping the
// differ's row bookkeeping for one frame and leaving a transitional
// stanza behind.
func (m *Model) pinFrameHeight() {
	if h := lipgloss.Height(composeFrame(m)); h > m.pinnedHeight {
		m.pinnedHeight = h
	}
}

// armPinRelease keeps a pinFrameHeight raise through this render (the close's
// own) and its one guaranteed clearScreenMsg follow-up, dropping the target
// back to the session floor (never to zero) only once both have rendered --
// see pinHoldFrames' own comment for why one call isn't enough.
func (m *Model) armPinRelease() {
	m.pinHoldFrames = 2
}

// openRegistryMenu opens the ctrl-k/right-click overlay from the request's
// own declared actions -- deriveMenu is the authority on which are dropped
// (every injected keybar default and every MenuHidden action stay keybar-only
// and never become menu rows). A request with nothing left to show leaves the
// picker untouched rather than opening an empty box.
func (m *Model) openRegistryMenu() {
	cursorRow := m.menuCursorRow()
	itemRow := cursorRow
	title := "Actions"
	if cursorRow >= 0 {
		title = leftPlainText(m.req.Rows[m.matches[cursorRow].Index])
		// An action row is a button, not an entry: item-scoped actions
		// (queue, open in editor...) have nothing to act on, so only the
		// globals list under its label.
		if m.cursorOnActionRow() {
			itemRow = -1
		}
	}
	rows := deriveMenu(m.req.Actions, itemRow)
	if len(rows) == 0 {
		return
	}
	m.modal = &modalState{kind: modalRegistry, Menu: NewMenu(title, menuItemsFromRegistry(rows), nil)}
}

// openTSModal opens the overlay from a wire PickModal message, rendering
// the same box a registry menu does. A registry menu already open owes the
// wire nothing and is simply replaced. A TS-driven modal already open is
// different: the wire contract owes its caller exactly one modal-result
// line, and silently overwriting m.modal would leave that caller blocked
// forever waiting for an answer that never comes -- so it gets answered
// null, the same way esc-dismissing it would, before the new one opens.
// Either way the caller's own ClearScreen on the ModalMsg case (picker.go)
// repaints the transition, so no overlay's own residue survives into the
// next one.
func (m *Model) openTSModal(pm protocol.PickModal) {
	if m.modal != nil && m.modal.kind == modalTSDriven {
		m.writeModalResult(nil)
	}
	m.modal = &modalState{kind: modalTSDriven, Menu: NewMenu(pm.Message, menuItemsFromPick(pm.Rows), nil)}
}

// menuItemsFromRegistry flattens deriveMenu's ordered rows (item rows, an
// optional Rule sentinel, then global rows) into MenuItems, with everything
// after the rule in a quiet second section -- the rule itself becomes a
// render-time boundary rather than a row of its own, so it can never end up
// under the cursor or survive into a filtered view with nothing left on one
// side.
func menuItemsFromRegistry(rows []MenuRow) []MenuItem {
	out := make([]MenuItem, 0, len(rows))
	global := false
	for _, r := range rows {
		if r.Rule {
			global = true
			continue
		}
		item := MenuItem{ID: r.ActionID, Label: r.Label, Hint: keyGlyph(r.Key)}
		if global {
			item.Section = 1
			item.Quiet = true
		}
		out = append(out, item)
	}
	return out
}

func menuItemsFromPick(rows []protocol.PickRow) []MenuItem {
	out := make([]MenuItem, len(rows))
	for i, r := range rows {
		out[i] = MenuItem{Label: leftPlainText(r), Hint: plainConcat(r.Right), Value: r.Value}
	}
	return out
}

// keyGlyph renders a wire key ("ctrl-o", "ctrl-space") in a menu's compact
// glyph form (⌃o, ⌃space): the keybar spells modifiers out because it has a
// whole footer line to work with, but a menu's key column is narrow, so
// only the modifier collapses to a glyph -- the base key stays literal.
func keyGlyph(key string) string {
	if key == "" {
		return ""
	}
	replacer := strings.NewReplacer("ctrl-", "⌃", "alt-", "⌥", "shift-", "⇧")
	return replacer.Replace(key)
}

func actionByID(actions []protocol.PickAction, id string) (protocol.PickAction, bool) {
	for _, a := range actions {
		if a.ID == id {
			return a, true
		}
	}
	return protocol.PickAction{}, false
}

// updateModal handles a key press while the overlay is open: navigation and
// typing stay local to the Menu, esc and enter close it. A passthrough key
// on a registry menu fires its registry binding straight from the menu.
func (m *Model) updateModal(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	return m.applyMenuOutcome(m.modal.Key(msg))
}

// applyMenuOutcome maps what the Menu reported onto the picker's own close,
// dispatch, and accelerator paths, shared by the key and click routes.
func (m *Model) applyMenuOutcome(out MenuOutcome) (tea.Model, tea.Cmd) {
	switch out.Kind {
	case MenuClosed:
		m.closeModal()
		m.armPinRelease()
		return m, tea.ClearScreen
	case MenuChosen:
		return m.selectModalRow(out.Item)
	case MenuPassthrough:
		if m.modal.kind == modalRegistry {
			if action, ok := m.actionForKey(out.Key); ok {
				return m.dispatchRegistryAction(action)
			}
		}
	}
	return m, nil
}

// closeModal dismisses whichever overlay is open. A TS-driven modal owes
// the caller a modal-result line even when nothing was selected (esc,
// click-outside) -- the caller is blocked mid-flow waiting for an answer --
// so this always answers null for that kind; a registry menu is purely
// local and owes the wire nothing on a plain dismiss.
func (m *Model) closeModal() {
	if m.modal.kind == modalTSDriven {
		m.writeModalResult(nil)
	}
	m.modal = nil
}

// selectModalRow dispatches the row the Menu chose. A TS-driven modal
// always answers with a modal-result line and closes. A registry menu row
// is dispatched exactly as if its action's key had been pressed on the main
// list: event:true stays open and emits a PickEvent, anything else ends the
// session with the ordinary terminal PickResult. Every path that closes the
// overlay without quitting the program repaints with a full-frame clear
// (see closeModal/applyMenuOutcome's MenuClosed case) so the next frame
// never shows the box's own residue underneath it.
func (m *Model) selectModalRow(item MenuItem) (tea.Model, tea.Cmd) {
	if m.modal.kind == modalTSDriven {
		value := item.Value
		m.writeModalResult(&value)
		m.modal = nil
		m.armPinRelease()
		return m, tea.ClearScreen
	}

	action, ok := actionByID(m.req.Actions, item.ID)
	if !ok {
		m.modal = nil
		m.armPinRelease()
		return m, tea.ClearScreen
	}
	return m.dispatchRegistryAction(action)
}

// dispatchRegistryAction closes the registry menu and fires action against
// the row the menu was opened for (the cursor: a right-click open moves it
// there first), exactly as if the action's key had been pressed on the main
// list. Shared by selecting a menu row and by pressing the action's own key
// while the menu is open -- the hint the menu prints for it is a live
// accelerator, not documentation.
func (m *Model) dispatchRegistryAction(action protocol.PickAction) (tea.Model, tea.Cmd) {
	m.modal = nil
	m.armPinRelease()
	if action.Event {
		m.emitEvent(action.ID)
		return m, tea.ClearScreen
	}
	m.resultForAction(action.ID)
	return m.quit()
}

// writeModalResult answers a TS-driven modal through the same ordered
// writer an event uses (Model.enqueueOutput in picker.go), never a second,
// unsynchronized path to output -- a modal-result line is a mid-flight
// Go->TS message exactly like an event, and has to land before the
// terminal result the same way.
func (m *Model) writeModalResult(value *string) {
	m.enqueueOutput(encodeModalResult(value))
}

func encodeModalResult(value *string) []byte {
	b, _ := json.Marshal(protocol.PickModalResult{T: "modal-result", Value: value})
	return append(b, '\n')
}
