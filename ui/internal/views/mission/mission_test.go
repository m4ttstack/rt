package mission_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rt-ui/internal/testutil"
)

func fixtureLine(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, b); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// TestOpenDecodesCurrentAndQuitEmitsClosedQuit mirrors the board's
// TestQuitConfirmsWhenRunningAndEmitsQuitOnY harness shape, minus the
// confirm layer this skeleton has no reason to gate behind yet.
func TestOpenDecodesCurrentAndQuitEmitsClosedQuit(t *testing.T) {
	s := testutil.StartSession(t, []string{testutil.Binary(t), "session", "--view", "mission"}, nil)
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"t":"hello"`) || !strings.Contains(l, `"mission"`) {
		t.Fatalf("hello: %q ok=%v", l, ok)
	}
	s.Send(fixtureLine(t, "session-open-mission.json"))
	s.WaitForPaint("main")
	if !strings.Contains(s.Screen(), "remote:github.com%2Fm4ttstack%2Frt") {
		t.Fatalf("Current.Repo not decoded onto the screen:\n%s", s.Screen())
	}
	s.Type("q")
	l, _ := s.ReadLine(2 * time.Second)
	if !strings.Contains(l, `"t":"intent"`) || !strings.Contains(l, `"quit"`) {
		t.Fatalf("expected a quit intent first: %q", l)
	}
	l, _ = s.ReadLine(2 * time.Second)
	if !strings.Contains(l, `"reason":"quit"`) {
		t.Fatalf("closed: %q", l)
	}
	if exit := s.Wait(); exit != 0 {
		t.Fatalf("exit %d", exit)
	}
}
