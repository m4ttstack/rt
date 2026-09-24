package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

func publishPromptMission(t *testing.T, seq int, name string) *Mission {
	t.Helper()
	m := newMouseTestMission()
	next := m.model
	next.PublishPrompt = &PublishPrompt{Seq: seq, Name: name}
	pushModel(t, m, next)
	return m
}

func TestPublishPromptOpensTheNameStepFilledIn(t *testing.T) {
	m := publishPromptMission(t, 1, "acme-app")
	if m.menu == nil || m.menu.Title() != publishTitle {
		t.Fatal("a publish prompt opens the Publish Repository dialog")
	}
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "acme-app") {
		t.Fatalf("the name step starts filled in:\n%s", out)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu == nil {
		t.Fatal("enter on the name moves to the visibility step without emitting")
	}
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"Keep this code private", "Public"} {
		if !strings.Contains(out, want) {
			t.Fatalf("visibility step missing %q:\n%s", want, out)
		}
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "acme-app") || strings.Contains(out, "Keep this code private") {
		t.Fatalf("esc on visibility returns to the name:\n%s", out)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("choosing a visibility emits and closes the dialog")
	}
}

func TestPublishPromptOpensOncePerSeq(t *testing.T) {
	m := publishPromptMission(t, 1, "acme-app")
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu != nil {
		t.Fatal("esc on the name step closes the dialog")
	}
	next := m.model
	next.PublishPrompt = &PublishPrompt{Seq: 1, Name: "acme-app"}
	pushModel(t, m, next)
	if m.menu != nil {
		t.Fatal("a seen seq must not reopen")
	}
	next.PublishPrompt = &PublishPrompt{Seq: 2, Name: "acme-app"}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != publishTitle {
		t.Fatal("a new seq opens again")
	}
}
