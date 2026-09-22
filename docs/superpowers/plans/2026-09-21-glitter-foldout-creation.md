# Glitter Foldout Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the branch foldout's "New branch from &lt;current&gt;…" row and the worktree foldout's "Provision new worktree…" row create a real branch and a real worktree, instead of answering with a placeholder notice.

**Architecture:** The Go modal engine gains a naming sub-mode: ctrl-n turns the foldout's existing filter line into a name field, and only the second enter emits. Both action-row intents gain a `name` field. The TypeScript driver creates the branch through `GitClient.createBranch` and provisions the worktree through the `worktree:provision` daemon verb, switching the board immediately and clearing a new `settling` flag when the daemon reports the tree ready.

**Tech Stack:** Go 1.26 with Bubble Tea v2 and lipgloss v2 (`ui/`), TypeScript on Bun (`lib/`, `packages/`), NDJSON over stdin/stdout between them.

**Spec:** `docs/superpowers/specs/2026-09-21-glitter-foldout-creation-design.md`

## Global Constraints

- This repo is public. NEVER write a Linear ticket id (`RT-123`) or an employer name into source, tests, comments, or commit messages. `bash scripts/repo-purity.sh` rejects them and gates CI.
- Never use em dashes or en dashes in any output, including code comments and commit messages. Use `...` or rephrase.
- Comments state a constraint the code cannot show (a parity anchor, an ordering trap, a non-obvious invariant). Never narrate what the next line does, and never cite review findings, task numbers, or ticket ids.
- All git access from TypeScript goes through argv arrays, never a shell string.
- `bun run ui:build` after ANY change under `ui/`, or the TypeScript side runs against a stale helper.
- lipgloss `Width()` WRAPS rather than truncates. Unclipped text adds rows and desyncs fixed-row hit-testing. Use the existing `clip()` for uncolored text; use `clipOn()` ONLY for already-ANSI-composed strings.
- `ui/internal/views/picker/scroll.go`'s `Viewport`/`ThumbSpan`/`ThumbCell` are the one scroll implementation for every scrolling region. Do not hand-roll a second copy.
- Tests are written first and must be seen to FAIL before the implementation is written. A test that cannot fail is a defect.

---

## File Structure

| File | Responsibility in this plan |
|---|---|
| `ui/internal/views/mission/mission.go` | Parameterize the text-input constructor; nothing else changes |
| `ui/internal/views/mission/modal.go` | Naming sub-mode: state, keys, payload plumbing, filter-line and keybar rendering |
| `ui/internal/views/mission/model.go` | `Current.Settling` wire field |
| `ui/internal/views/mission/mission_test.go` | Naming-mode key and emission tests (replaces four existing tests) |
| `ui/internal/views/mission/render_test.go` | Geometry-invariance test between filtering and naming |
| `lib/ui/protocol.ts` | `MissionCurrent.settling` |
| `lib/mission/model.ts` | `MissionState.settling`; `buildModel` emits it |
| `lib/mission/driver.ts` | Branch creation, worktree provisioning, readiness subscription |
| `lib/mission/__tests__/driver.test.ts` | Driver tests (replaces two existing tests) |
| `ui/fixtures/session-model-mission.json` | Golden handshake gains `current.settling` |
| `docs/design/mission/README.md` | Record the naming affordance; remove the two deferred lines |

---

### Task 1: Parameterize the text-input constructor

`newCommitInput` hardcodes its width to the sidebar. The modal needs the same styled input at a different width, so the constructor takes a width instead of being copied.

**Files:**
- Modify: `ui/internal/views/mission/mission.go:118-134` (`newCommitInput`)
- Modify: `ui/internal/views/mission/mission.go:101-102` (its two call sites)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `func newTextInput(placeholder string, width int) textinput.Model` in package `mission`. Task 2 calls it.

- [ ] **Step 1: Rename the constructor and add the width parameter**

In `ui/internal/views/mission/mission.go`, replace the function at lines 118-134 with:

```go
// Pink cursor, Faint placeholder, no prompt glyph (the caller's own box or
// line is the only chrome).
func newTextInput(placeholder string, width int) textinput.Model {
	ti := textinput.New()
	ti.Prompt = ""
	ti.CharLimit = 0
	ti.Placeholder = placeholder
	ti.SetWidth(width)
	styles := ti.Styles()
	styles.Focused.Text = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Text)
	styles.Focused.Placeholder = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Faint)
	styles.Blurred.Text = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Text)
	styles.Blurred.Placeholder = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Faint)
	styles.Cursor.Color = theme.Pink
	ti.SetStyles(styles)
	return ti
}
```

- [ ] **Step 2: Update the two call sites**

At `ui/internal/views/mission/mission.go:101-102`, change:

```go
	summaryInput:     newCommitInput(""),
	descriptionInput: newCommitInput("Description"),
```

to:

```go
	summaryInput:     newTextInput("", commitBoxInner),
	descriptionInput: newTextInput("Description", commitBoxInner),
```

- [ ] **Step 3: Verify nothing else referenced the old name**

Run: `cd ui && grep -rn "newCommitInput" .`
Expected: no output.

- [ ] **Step 4: Build and run the existing suite**

Run: `cd ui && go build ./... && go test ./internal/views/mission/`
Expected: PASS. This is a pure rename plus a parameter; no behavior changed, so the existing tests are the regression check.

- [ ] **Step 5: Commit**

```bash
git add ui/internal/views/mission/mission.go
git commit -m "rt-ui mission: parameterize the text input constructor on width"
```

---

### Task 2: Naming sub-mode in the modal engine

ctrl-n (and enter on the action slot) currently emit a frozen payload and close. They now open a name field instead; only the second enter emits, carrying the typed name.

**Files:**
- Modify: `ui/internal/views/mission/modal.go:45-48` (`modalActionRow`), `:52-81` (`modalState`, `newModal`), `:91-102` (payload structs), `:134-187` (branch and worktree constructors), `:356-385` (`modalKey`), `:405-413` (`selectModalAction`)
- Test: `ui/internal/views/mission/mission_test.go`

**Interfaces:**
- Consumes: `newTextInput(placeholder string, width int) textinput.Model` from Task 1.
- Produces: `modalState.naming bool` and `modalState.nameInput textinput.Model`; `modalActionRow.buildPayload func(name string) json.RawMessage` replacing its `payload` field; `checkoutNewPayload{New, From, Name}` and `worktreeNewPayload{New, Name}` carrying `name`. Task 3 renders from `naming`/`nameInput`; Tasks 5 and 6 consume the `name` field on the wire.

- [ ] **Step 1: Write the failing tests**

Replace the four tests at `ui/internal/views/mission/mission_test.go:479-537` (`TestBranchActionRowEmitsCheckoutNewFromCurrent`, `TestWorktreeActionRowEmitsWorktreeNew`, and their two ctrl-n variants) with the following. They assert the new contract, so they must be seen to fail before the implementation exists.

```go
func TestCtrlNEntersNamingWithoutEmitting(t *testing.T) {
	for _, tc := range []struct {
		name string
		open string
	}{
		{"branch", "b"},
		{"worktree", "w"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, em := newTestMission(t)
			m.Update(keyPress(tc.open))
			em.reset()
			m.Update(keyPress("ctrl+n"))
			if got := em.emitted(); len(got) != 0 {
				t.Fatalf("ctrl-n emitted %v, want nothing until a name is entered", got)
			}
			if !m.modal.naming {
				t.Fatal("ctrl-n did not enter naming mode")
			}
		})
	}
}

func TestNamingEnterEmitsTypedName(t *testing.T) {
	for _, tc := range []struct {
		name   string
		open   string
		intent string
		want   string
	}{
		{"branch", "b", "mission:checkout", `{"new":true,"from":"rt-191-mission-tui","name":"my-feature"}`},
		{"worktree", "w", "mission:worktree", `{"new":true,"name":"my-feature"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, em := newTestMission(t)
			m.Update(keyPress(tc.open))
			m.Update(keyPress("ctrl+n"))
			em.reset()
			for _, r := range "my-feature" {
				m.Update(keyPress(string(r)))
			}
			m.Update(keyPress("enter"))

			got := em.emitted()
			if len(got) != 1 {
				t.Fatalf("emitted %d intents, want 1: %v", len(got), got)
			}
			if got[0].Name != tc.intent {
				t.Fatalf("intent = %q, want %q", got[0].Name, tc.intent)
			}
			if string(got[0].Payload) != tc.want {
				t.Fatalf("payload = %s, want %s", got[0].Payload, tc.want)
			}
			if m.modal != nil {
				t.Fatal("modal stayed open after a successful create")
			}
		})
	}
}

func TestNamingEnterWithBlankNameDoesNothing(t *testing.T) {
	m, em := newTestMission(t)
	m.Update(keyPress("b"))
	m.Update(keyPress("ctrl+n"))
	em.reset()
	for _, r := range "   " {
		m.Update(keyPress(string(r)))
	}
	m.Update(keyPress("enter"))

	if got := em.emitted(); len(got) != 0 {
		t.Fatalf("a whitespace-only name emitted %v, want nothing", got)
	}
	if m.modal == nil || !m.modal.naming {
		t.Fatal("a blank enter should leave the modal open and still naming")
	}
}

func TestEscLeavesNamingButKeepsTheModalOpen(t *testing.T) {
	m, _ := newTestMission(t)
	m.Update(keyPress("b"))
	m.Update(keyPress("ctrl+n"))
	m.Update(keyPress("esc"))

	if m.modal == nil {
		t.Fatal("first esc closed the modal, want it to only leave naming")
	}
	if m.modal.naming {
		t.Fatal("esc did not leave naming mode")
	}
	m.Update(keyPress("esc"))
	if m.modal != nil {
		t.Fatal("second esc did not close the modal")
	}
}

func TestNamingTypingDoesNotFilterTheList(t *testing.T) {
	m, _ := newTestMission(t)
	m.Update(keyPress("b"))
	before := len(m.modal.matches)
	m.Update(keyPress("ctrl+n"))
	for _, r := range "zzzz" {
		m.Update(keyPress(string(r)))
	}
	if got := len(m.modal.matches); got != before {
		t.Fatalf("typing a name refiltered the list to %d rows, want %d unchanged", got, before)
	}
}
```

If `newTestMission`, `keyPress`, or the emitter's `reset`/`emitted` helpers are named differently in this file, use the existing helpers rather than adding new ones. Read the top of `mission_test.go` first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && go test ./internal/views/mission/ -run 'Naming|CtrlNEnters|EscLeaves'`
Expected: FAIL to compile, with `m.modal.naming undefined`.

- [ ] **Step 3: Add naming state to the modal**

In `ui/internal/views/mission/modal.go`, change `modalActionRow` (lines 45-48) to build its payload from the typed name, mirroring how ordinary rows already build theirs from `row.value`:

```go
type modalActionRow struct {
	label        string
	buildPayload func(name string) json.RawMessage
}
```

Add two fields to `modalState` (after `cursor`, around line 61):

```go
	// naming is the action row's second step: ctrl-n opens a name field in
	// place of the filter line and only the following enter emits. The
	// field is separate from query because refilter() resets the cursor on
	// every keystroke, which a name being typed must not do.
	naming    bool
	nameInput textinput.Model
```

Add `"charm.land/bubbles/v2/textinput"` to the file's imports.

- [ ] **Step 4: Make ctrl-n open the field instead of emitting**

Replace `selectModalAction` (lines 405-413) with:

```go
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
	ms.nameInput = newTextInput(ms.namePlaceholder, modalNameWidth(ms))
	return m, ms.nameInput.Focus()
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
```

- [ ] **Step 5: Route keys while naming**

Replace `modalKey` (lines 356-385) with:

```go
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
```

Arrows fall through to the text input while naming, which is what makes the row list inert without a separate guard.

- [ ] **Step 6: Add the name placeholder and width helpers**

Add to `modalState` (beside `placeholder`):

```go
	namePlaceholder string
```

Change `newModal`'s signature and body (lines 77-81) to carry it:

```go
func newModal(zone zoneID, intent, placeholder, namePlaceholder string, buildPayload func(string) json.RawMessage, rows []modalRow, action *modalActionRow) *modalState {
	ms := &modalState{zone: zone, intent: intent, placeholder: placeholder, namePlaceholder: namePlaceholder, buildPayload: buildPayload, rows: rows, action: action, hoverRow: -1}
	ms.refilter()
	return ms
}
```

Add the width helper next to `modalFixedRows`:

```go
// modalNameWidth is the name field's own width: the filter line's text area,
// which is the box's content width less the chevron and its trailing space.
func modalNameWidth(ms *modalState) int {
	w := modalWidth(ms) - lipgloss.Width(theme.GlyphChevron) - 1
	if w < 0 {
		return 0
	}
	return w
}
```

- [ ] **Step 7: Add `name` to both action payloads and update the three constructors**

Change the payload structs (lines 91-102):

```go
type checkoutNewPayload struct {
	New  bool   `json:"new"`
	From string `json:"from"`
	Name string `json:"name"`
}

type worktreeNewPayload struct {
	New  bool   `json:"new"`
	Name string `json:"name"`
}
```

In `newBranchModal`, replace the action row and the `newModal` call:

```go
	action := &modalActionRow{
		label: "New branch from " + m.Current.Branch + "…",
		buildPayload: func(name string) json.RawMessage {
			return mustPayload(checkoutNewPayload{New: true, From: m.Current.Branch, Name: name})
		},
	}
	return newModal(zoneBranch, "mission:checkout", "filter branches", "new branch name", func(v string) json.RawMessage {
		return mustPayload(checkoutPayload{Branch: v})
	}, rows, action)
```

In `newWorktreeModal`:

```go
	action := &modalActionRow{
		label: "Provision new worktree…",
		buildPayload: func(name string) json.RawMessage {
			return mustPayload(worktreeNewPayload{New: true, Name: name})
		},
	}
```

and its `newModal` call gains the name placeholder:

```go
	return newModal(zoneWorktree, "mission:worktree", "filter worktrees · "+repoLabel, "branch name for the new worktree", func(v string) json.RawMessage {
		return mustPayload(worktreePayload{Path: v})
	}, rows, action)
```

In `newRepoModal`, which has no action row, pass an empty name placeholder:

```go
	return newModal(zoneRepo, "mission:repo", "filter repos", "", func(v string) json.RawMessage {
		return mustPayload(repoPayload{Repo: v})
	}, rows, nil)
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd ui && go test ./internal/views/mission/ -run 'Naming|CtrlNEnters|EscLeaves'`
Expected: PASS.

- [ ] **Step 9: Run the whole package and build the helper**

Run: `cd ui && go vet ./... && go test ./internal/views/mission/`
Expected: PASS.
Run: `bun run ui:build`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add ui/internal/views/mission/modal.go ui/internal/views/mission/mission_test.go ui/dist/rt-ui
git commit -m "rt-ui mission: ctrl-n opens a name field instead of emitting"
```

---

### Task 3: Render the name field, and pin the geometry

The whole reason the name field reuses the filter line is that the box keeps its exact height and hit zones. That has to be an assertion, not an intention.

**Files:**
- Modify: `ui/internal/views/mission/modal.go:502-515` (`modalFilterLine`), `:673-684` (`modalKeybarPairs`), and the `modalBoxLines` call site of `modalFilterLine`
- Test: `ui/internal/views/mission/render_test.go`

**Interfaces:**
- Consumes: `modalState.naming`, `modalState.nameInput`, `modalState.namePlaceholder` from Task 2.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

Add to `ui/internal/views/mission/render_test.go`:

```go
func TestNamingKeepsTheModalGeometryIdentical(t *testing.T) {
	m, _ := newTestMission(t)
	m.Update(keyPress("b"))
	before := m.View().String()
	m.Update(keyPress("ctrl+n"))
	after := m.View().String()

	beforeLines := strings.Split(before, "\n")
	afterLines := strings.Split(after, "\n")
	if len(beforeLines) != len(afterLines) {
		t.Fatalf("naming changed the frame height: %d lines, want %d", len(afterLines), len(beforeLines))
	}
	for i := range beforeLines {
		if bw, aw := lipgloss.Width(beforeLines[i]), lipgloss.Width(afterLines[i]); bw != aw {
			t.Fatalf("line %d width changed from %d to %d while naming", i, bw, aw)
		}
	}
}

func TestNamingShowsItsPlaceholderAndKeybar(t *testing.T) {
	m, _ := newTestMission(t)
	m.Update(keyPress("b"))
	m.Update(keyPress("ctrl+n"))
	screen := testutil.Screen(m.View().String())

	if !strings.Contains(screen, "new branch name") {
		t.Fatalf("name placeholder missing:\n%s", screen)
	}
	if strings.Contains(screen, "filter branches") {
		t.Fatalf("filter placeholder still painted while naming:\n%s", screen)
	}
	if !strings.Contains(screen, "enter create") || !strings.Contains(screen, "esc cancel") {
		t.Fatalf("naming keybar missing:\n%s", screen)
	}
}

func TestNamingHidesTheRowCursor(t *testing.T) {
	m, _ := newTestMission(t)
	m.Update(keyPress("b"))
	withCursor := testutil.Screen(m.View().String())
	m.Update(keyPress("ctrl+n"))
	naming := testutil.Screen(m.View().String())

	// The cursor glyph marks which row enter would take. While naming,
	// enter creates instead, so leaving it painted would be a lie.
	if strings.Count(naming, theme.GlyphCursor) >= strings.Count(withCursor, theme.GlyphCursor) {
		t.Fatalf("row cursor still painted while naming:\n%s", naming)
	}
}
```

`theme.GlyphCursor` is a placeholder for whatever constant `modalRowLine` actually uses to mark the cursor row. Read `modalRowLine` (`modal.go:543-588`) first and assert against the real glyph or the real style, whichever that function keys on.

Use whatever `View()`-to-string helper the neighbouring render tests already use; read the top of `render_test.go` first rather than inventing one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && go test ./internal/views/mission/ -run 'Naming(Keeps|Shows)'`
Expected: FAIL on the placeholder assertion, because the filter line still paints `filter branches`.

- [ ] **Step 3: Paint the input on the filter line**

Replace `modalFilterLine` (lines 502-515) with a version that takes the whole state, so the one line serves both modes:

```go
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
```

Update its call site in `modalBoxLines` to pass `ms` and the width instead of the old three arguments.

- [ ] **Step 4: Switch the keybar while naming**

Change `modalKeybarPairs` (lines 673-684) to take the state:

```go
func modalKeybarPairs(ms *modalState) [][2]string {
	if ms.naming {
		return [][2]string{{"enter", "create"}, {"esc", "cancel"}}
	}
	switch ms.zone {
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
```

Update `modalKeybarPlainText` and every other caller to pass `ms` rather than `ms.zone`. `modalKeybarPlainText` feeds `modalWidth`, so it must see the same pairs the keybar paints or the box can size to the wrong content.

- [ ] **Step 5: Hide the row cursor while naming**

`modalRowLine` decides a row's fill from whether its index equals `ms.cursor`. Add `!ms.naming` to that condition so no row paints as the cursor row while a name is being typed. Change only the cursor branch; hover is the mouse's own state and stays as it is.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ui && go test ./internal/views/mission/ -run 'Naming(Keeps|Shows|Hides)'`
Expected: PASS.

- [ ] **Step 7: Run the whole package, vet, and build**

Run: `cd ui && go vet ./... && go test ./...`
Expected: PASS.
Run: `bun run ui:build`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add ui/internal/views/mission/modal.go ui/internal/views/mission/render_test.go ui/dist/rt-ui
git commit -m "rt-ui mission: paint the name field on the foldout's filter line"
```

---

### Task 4: Create the branch from the foldout

**Files:**
- Modify: `lib/mission/driver.ts:83-87` (`CheckoutPayload`), `:733-755` (`handleCheckout`)
- Test: `lib/mission/__tests__/driver.test.ts`

**Interfaces:**
- Consumes: the `mission:checkout` payload `{new: true, from: string, name: string}` from Task 2.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mission/__tests__/driver.test.ts`, inside the checkout describe block:

```ts
test("a new-branch intent creates the branch from the given base and checks it out", async () => {
  const session = new FakeSession([
    { t: "intent", name: "mission:checkout", payload: { new: true, from: "main", name: "my-feature" } },
    { t: "intent", name: "quit" },
  ]);
  const client = makeFakeClient();
  await new MissionDriver(baseDeps({ session, client }), START).run();

  expect(client.calls.createBranch).toEqual([
    { name: "my-feature", opts: { from: "main", checkout: true } },
  ]);
  const last = session.pushed.at(-1) as MissionModel;
  expect(last.notice).toBe("");
});

test("a failed branch creation surfaces the git message as a notice", async () => {
  const session = new FakeSession([
    { t: "intent", name: "mission:checkout", payload: { new: true, from: "main", name: "bad name" } },
    { t: "intent", name: "quit" },
  ]);
  const client = makeFakeClient({
    createBranch: async () => {
      throw new Error("invalid branch name: bad name");
    },
  });
  await new MissionDriver(baseDeps({ session, client }), START).run();

  const last = session.pushed.at(-1) as MissionModel;
  expect(last.notice).toBe("invalid branch name: bad name");
});
```

`makeFakeClient` has no `createBranch` recorder yet. Add one: extend its overrides type with `createBranch?: GitClient["createBranch"]`, add `createBranch: []` to `FakeClientCalls`, and implement it as:

```ts
    createBranch: async (name: string, opts?: { from?: string; checkout?: boolean }) => {
      calls.createBranch.push({ name, opts });
      if (overrides.createBranch) await overrides.createBranch(name, opts);
    },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/driver.test.ts -t "new-branch intent"`
Expected: FAIL. `createBranch` is never called; the driver sets the notice `use rt worktree provision` instead.

- [ ] **Step 3: Widen the payload type**

At `lib/mission/driver.ts:83-87`:

```ts
interface CheckoutPayload {
  branch?: string;
  new?: boolean;
  from?: string;
  name?: string;
}
```

- [ ] **Step 4: Handle the new-branch case**

Replace the placeholder block at the top of `handleCheckout` (lines 733-742) with:

```ts
  private async handleCheckout(payload: CheckoutPayload | undefined): Promise<void> {
    if (!payload) return;
    if (payload.new === true) {
      await this.createBranch(payload);
      return;
    }
    if (typeof payload.branch !== "string") return;
```

and add the new method below `handleCheckout`:

```ts
  private async createBranch(payload: CheckoutPayload): Promise<void> {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name === "") return;
    const client = this.deps.client(this.state.currentWorktree);
    try {
      // One atomic checkout -b: git leaves no branch behind when the
      // checkout itself fails, so a dirty tree cannot strand one.
      await client.createBranch(name, { from: payload.from, checkout: true });
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
      this.push();
      return;
    }
    this.state.notice = "";
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/driver.test.ts -t "branch"`
Expected: PASS.

- [ ] **Step 6: Typecheck and run the suite**

Run: `bunx tsc --noEmit`
Expected: no output.
Run: `bun test lib/mission`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/mission/driver.ts lib/mission/__tests__/driver.test.ts
git commit -m "mission driver: create a branch from the foldout's action row"
```

---

### Task 5: Provision the worktree from the foldout

**Files:**
- Modify: `lib/mission/driver.ts:89-92` (`WorktreePayload`), `:757-771` (`handleWorktree`)
- Test: `lib/mission/__tests__/driver.test.ts`

**Interfaces:**
- Consumes: the `mission:worktree` payload `{new: true, name: string}` from Task 2.
- Produces: `MissionDriver` calls `daemonQuery("worktree:provision", {repoName, branch, owner: "glitter"}, PROVISION_TIMEOUT_MS)`. Task 6 reads `readyPending` off that same response.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mission/__tests__/driver.test.ts`. Note the two existing tests at lines 1000-1029 asserting the `use rt worktree provision` notice must be DELETED in this step; they pin the behavior being removed.

```ts
describe("MissionDriver: provisioning a worktree", () => {
  test("provisions with the typed branch name and switches the board to the new tree", async () => {
    const calls: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "my-feature" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
        calls.push({ cmd, payload: payload ?? {} });
        if (cmd === "worktree:provision") {
          return { ok: true, data: { tree: "rohan", path: "/trees/rohan", branch: "my-feature", readyPending: false } };
        }
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    const provision = calls.find((c) => c.cmd === "worktree:provision");
    expect(provision?.payload).toMatchObject({ branch: "my-feature", owner: "glitter" });
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.worktree).toBe("/trees/rohan");
  });

  test("a refusal surfaces as a notice and leaves the board where it was", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "my-feature" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) => {
        if (cmd === "worktree:provision") return { ok: false, error: "busy" };
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    const last = session.pushed.at(-1) as MissionModel;
    expect(last.notice).toBe("another worktree operation is running; try again in a moment");
    expect(last.current.worktree).toBe(START.worktree);
  });

  test("a blank name never reaches the daemon", async () => {
    const calls: string[] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "   " } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      daemonQuery: async (cmd: string) => {
        calls.push(cmd);
        if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
        return { ok: true, data: { repos: [] } };
      },
    });

    await new MissionDriver(deps, START).run();

    expect(calls).not.toContain("worktree:provision");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/driver.test.ts -t "provisioning a worktree"`
Expected: FAIL. No `worktree:provision` call is made.

- [ ] **Step 3: Widen the payload type and add the constants**

At `lib/mission/driver.ts:89-92`:

```ts
interface WorktreePayload {
  path?: string;
  new?: boolean;
  name?: string;
}
```

Add near the other module constants (beside `DISCARD_CONFIRM_WINDOW_MS`):

```ts
/** Matches the provision CLI's own ceiling: claiming a tree and checking out can legitimately take minutes. */
const PROVISION_TIMEOUT_MS = 6 * 60_000;

/** The daemon's typed refusals, in the words a board reader can act on. */
const PROVISION_REFUSALS: Record<string, string> = {
  "repo-unknown": "this repo is not registered with rt",
  busy: "another worktree operation is running; try again in a moment",
  "branch-unresolved": "a branch name is required to provision a worktree",
  "handoff-write-failed": "the tree was created but could not be claimed; check rt worktree list",
};
```

- [ ] **Step 4: Handle the provision case**

Replace the placeholder block at the top of `handleWorktree` (lines 757-765) with:

```ts
  private async handleWorktree(payload: WorktreePayload | undefined): Promise<void> {
    if (!payload) return;
    if (payload.new === true) {
      await this.provisionWorktree(payload);
      return;
    }
    if (typeof payload.path !== "string") return;
```

and add below it:

```ts
  private async provisionWorktree(payload: WorktreePayload): Promise<void> {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name === "") return;
    // owner marks the tree's origin in the registry, the way the Claude hook
    // and the herd handler mark theirs.
    const res = await this.deps.daemonQuery("worktree:provision", {
      repoName: this.state.currentRepo,
      branch: name,
      owner: "glitter",
    }, PROVISION_TIMEOUT_MS);

    if (!res) {
      this.state.notice = "the rt daemon is not running";
      this.push();
      return;
    }
    if (!res.ok) {
      const code = typeof res.error === "string" ? res.error : "unknown";
      this.state.notice = PROVISION_REFUSALS[code] ?? `could not provision a worktree: ${code}`;
      this.push();
      return;
    }

    const data = res.data as { path?: string } | undefined;
    if (typeof data?.path !== "string") {
      this.state.notice = "the daemon provisioned a tree but returned no path";
      this.push();
      return;
    }
    this.state.notice = "";
    this.state.currentWorktree = data.path;
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/driver.test.ts -t "provisioning a worktree"`
Expected: PASS.

- [ ] **Step 6: Typecheck and run the suite**

Run: `bunx tsc --noEmit`
Expected: no output.
Run: `bun test lib/mission`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/mission/driver.ts lib/mission/__tests__/driver.test.ts
git commit -m "mission driver: provision a worktree from the foldout's action row"
```

---

### Task 6: Show readiness while the new tree settles

`worktree:provision` returns before installs and hooks finish. The board switches immediately, so it has to say the tree is still settling.

**Files:**
- Modify: `lib/ui/protocol.ts:219-226` (`MissionCurrent`), `lib/mission/model.ts:49-62` (`MissionState`) and `:446-453` (`buildModel`'s `current`), `lib/mission/driver.ts` (state seed, subscription, provision handler), `ui/internal/views/mission/model.go:95-103` (`Current`), `ui/internal/views/mission/topbar.go` (worktree segment), `ui/fixtures/session-model-mission.json`
- Test: `lib/mission/__tests__/driver.test.ts`, `ui/internal/views/mission/render_test.go`

**Interfaces:**
- Consumes: the provision response from Task 5.
- Produces: `MissionCurrent.settling: boolean` on the wire; `Current.Settling bool` in Go.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mission/__tests__/driver.test.ts`:

```ts
test("a readyPending provision leaves the board settling until the daemon says otherwise", async () => {
  let emit: ((ev: { type: string; data?: Record<string, unknown> }) => void) | null = null;
  const session = new FakeSession([
    { t: "intent", name: "mission:worktree", payload: { new: true, name: "my-feature" } },
    { t: "intent", name: "quit" },
  ]);
  const deps = baseDeps({
    session,
    daemonQuery: async (cmd: string) => {
      if (cmd === "worktree:provision") {
        return { ok: true, data: { tree: "rohan", path: "/trees/rohan", branch: "my-feature", readyPending: true, readySteps: ["install"] } };
      }
      if (cmd === "worktree:list") return { ok: true, data: { trees: defaultTrees() } };
      return { ok: true, data: { repos: [] } };
    },
  });
  deps.subscribe = (onEvent) => {
    emit = onEvent as typeof emit;
    return { close: () => {} };
  };

  await new MissionDriver(deps, START).run();

  const afterProvision = session.pushed.find((m) => (m as MissionModel).current.worktree === "/trees/rohan") as MissionModel;
  expect(afterProvision.current.settling).toBe(true);
});

test("buildModel reports settling false by default", () => {
  const model = buildModel(baseState(), baseInputs());
  expect(model.current.settling).toBe(false);
});
```

For the second test use whatever `buildModel` fixture helpers `lib/mission/__tests__/model.test.ts` already defines, and put it in that file rather than the driver's.

Add to `ui/internal/views/mission/render_test.go`:

```go
func TestSettlingWorktreeShowsInTheTopBar(t *testing.T) {
	m, _ := newTestMission(t)
	model := m.model
	model.Current.Settling = true
	m.SetModel(model)
	screen := testutil.Screen(m.View().String())
	if !strings.Contains(screen, "settling") {
		t.Fatalf("settling worktree not marked in the top bar:\n%s", screen)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission -t "settling"` and `cd ui && go test ./internal/views/mission/ -run Settling`
Expected: both FAIL, the TS one on `current.settling` being undefined and the Go one on `Settling` being an unknown field.

- [ ] **Step 3: Add the field to both sides of the wire**

`lib/ui/protocol.ts`, in `MissionCurrent`:

```ts
  /** The tree was provisioned moments ago and its ready steps are still running in the daemon. */
  settling: boolean;
```

`ui/internal/views/mission/model.go`, in `Current`:

```go
	Settling     bool   `json:"settling"`
```

`lib/mission/model.ts`, in `MissionState` (after `busyAction`):

```ts
  settling: boolean;
```

and in `buildModel`'s `current` object:

```ts
    settling: state.settling,
```

- [ ] **Step 4: Seed the state and update the fixture**

In `lib/mission/driver.ts`, add `settling: false,` to the state literal in the constructor (beside `notice: ""`).

`lib/mission/__tests__/model.test.ts:167` asserts that `buildModel` reproduces `ui/fixtures/session-model-mission.json` **byte for byte**, and there is no generator script. So the fixture is edited to match what `buildModel` now emits, never the other way around.

Run: `bun test lib/mission/__tests__/model.test.ts -t "byte for byte"`
Expected: FAIL, with the diff showing `settling` present in the built model and absent from the fixture.

Add `"settling": false` to the `current` object in `ui/fixtures/session-model-mission.json`, placing it last so the key order matches the order `buildModel` writes its properties.

Run: `bun test lib/mission/__tests__/model.test.ts -t "byte for byte"`
Expected: PASS. If it still fails on key order, reorder the fixture key to match the built object rather than reordering `buildModel`.

- [ ] **Step 5: Set and clear the flag**

In `provisionWorktree` (Task 5), after `this.state.currentWorktree = data.path;` add:

```ts
    this.state.settling = (data as { readyPending?: boolean }).readyPending === true;
```

and widen the local type annotation on `data` to `{ path?: string; readyPending?: boolean }`.

In `run()`'s subscription (`driver.ts:214-219`), replace the single-type guard:

```ts
    const sub = this.deps.subscribe((ev) => {
      if (ev.type === "worktree:ready-settled") {
        const data = ev.data as { path?: string; ok?: boolean } | undefined;
        if (data?.path !== this.state.currentWorktree) return;
        this.state.settling = false;
        if (data?.ok === false) {
          this.state.notice = "a ready step failed; dependencies in this tree may be stale";
        }
        this.push();
        return;
      }
      if (ev.type !== "git-status") return;
      void this.onGitStatus().catch((err) => {
        this.state.notice = `error: ${err instanceof Error ? err.message : String(err)}`;
        this.push();
      });
    });
```

- [ ] **Step 6: Paint it in the top bar**

In `ui/internal/views/mission/topbar.go`, find where the Current Worktree segment builds its value text and append a settling marker when `m.Current.Settling` is true. The segment already clips its text, so append before the clip, not after:

```go
	worktreeText := m.Current.WorktreeName
	if m.Current.Settling {
		worktreeText += "  settling"
	}
```

Use the existing variable names in that function rather than these if they differ.

- [ ] **Step 7: Run both suites**

Run: `bun test lib/mission && bunx tsc --noEmit`
Expected: PASS, no type output.
Run: `cd ui && go vet ./... && go test ./...`
Expected: PASS.
Run: `bun run ui:build`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/ui/protocol.ts lib/mission/model.ts lib/mission/driver.ts lib/mission/__tests__ ui/internal/views/mission ui/fixtures/session-model-mission.json ui/dist/rt-ui
git commit -m "mission: mark a freshly provisioned worktree as settling until the daemon reports it ready"
```

---

### Task 7: Record the affordance on the design boards

The milestone rule is that every "Deferred to v2" line in the design README has a ticket and every ticket has a line. Both rows ship here, so both lines come off.

**Files:**
- Modify: `docs/design/mission/README.md`

**Interfaces:**
- Consumes: the behavior built in Tasks 2 through 6.
- Produces: nothing.

- [ ] **Step 1: Read the two sections you are about to change**

Run: `grep -n "Deferred to v2" -A 30 docs/design/mission/README.md`
Run: `grep -n "parity checklist" -A 30 docs/design/mission/README.md`

- [ ] **Step 2: Remove the two deferred lines**

Delete the "Deferred to v2" bullets covering the branch foldout's new-branch row and the worktree foldout's provision row. Leave every other bullet alone.

- [ ] **Step 3: Add the naming affordance to the parity checklist**

Under the checklist's composition section, add:

```markdown
- **Foldout name entry.** A foldout that can create something collects the
  name inline: ctrl-n turns the filter line into a name field, the row list
  goes inert, and the keybar reads `enter create · esc cancel`. The box keeps
  its exact height and hit zones, because an extra line would have to be
  mirrored by hand in the modal's own hit-test walk. Ratified 2026-09-21.
```

- [ ] **Step 4: Run the purity gate**

Run: `bash scripts/repo-purity.sh`
Expected: `ok   repo-purity`.

- [ ] **Step 5: Commit**

```bash
git add docs/design/mission/README.md
git commit -m "design boards: record the foldout name-entry affordance"
```

---

### Task 8: Full-gate sweep

Every gate CI runs, plus the two this repo's footguns make easy to skip.

**Files:** none.

- [ ] **Step 1: TypeScript**

Run: `bunx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Unit suites**

Run: `bun test lib commands packages scripts`
Expected: PASS. If a failure looks unrelated to this branch, verify it against clean `main` before calling it pre-existing.

- [ ] **Step 3: Go**

Run: `cd ui && go vet ./... && go test -count=1 ./...`
Expected: PASS. `-count=1` defeats the test cache, which otherwise hides a real regression behind a cached pass.

- [ ] **Step 4: End to end**

Run: `bun run test:e2e`
Expected: PASS except `user plugins > rt plugin new`, which fails on a broken local mise node shim and fails identically on `main`.

Run: `bun run test:pty`
Expected: PASS. This drives the real binary, so it is the gate that proves the naming mode did not break the board's existing key handling.

- [ ] **Step 5: Purity and docs**

Run: `bash scripts/repo-purity.sh`
Expected: `ok   repo-purity`.
Run: `bun run docs:check`
Expected: in sync. No command descriptions changed here, but this gate is cheap and was missed once already on this project.

- [ ] **Step 6: Commit any gate fallout**

```bash
git add -A
git commit -m "glitter foldout creation: gate fallout"
```

Skip this step if the tree is clean.
