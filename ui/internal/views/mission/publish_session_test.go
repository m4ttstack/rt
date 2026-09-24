package mission_test

import (
	"strings"
	"testing"
)

// TestPublishDialogEmitsNameAndVisibility drives the real binary, where the
// emitted intent line is readable: private is the first choice, as Desktop
// checks "Keep this code private" by default.
func TestPublishDialogEmitsNameAndVisibility(t *testing.T) {
	for _, tc := range []struct {
		keys []string
		want string
	}{
		{[]string{"\r", "\r"}, `"payload":{"name":"acme-app","private":true}`},
		{[]string{"\r", keyDown, "\r"}, `"payload":{"name":"acme-app","private":false}`},
	} {
		model := strings.Replace(fixtureModelJSON(t, "session-model-mission.json"), `"publishPrompt":null`, `"publishPrompt":{"seq":1,"name":"acme-app"}`, 1)
		s := openMission(t, model, "Publish Repository")
		for _, k := range tc.keys {
			s.Type(k)
		}
		if l := waitIntent(t, s, "mission:publish"); !strings.Contains(l, tc.want) {
			t.Fatalf("publish intent %q, want %s", l, tc.want)
		}
		s.Send(`{"t":"close"}`)
		s.Wait()
	}
}
