// Publish Repository: GitHub Desktop's dialog (app/src/ui/publish-repository)
// as two menu steps, the name and then its visibility. The driver runs the
// publish; this only collects what it needs.
package mission

import (
	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/views/picker"
)

const (
	publishTitle     = "Publish Repository"
	publishNameID    = "publish-name"
	publishPrivateID = "publish-private"
	publishPublicID  = "publish-public"
)

type publishPayload struct {
	Name    string `json:"name"`
	Private bool   `json:"private"`
}

func (m *Mission) openPublishDialog(p PublishPrompt) {
	m.showMenuBox(picker.NewNameMenu(publishTitle, "Name (owner/name for an organization)", p.Name, picker.MenuItem{ID: publishNameID}, nil), menuTarget{})
}

// publishVisibilityItems carries the name on both choices, so the step
// that answers them needs nothing else from the one before.
func publishVisibilityItems(name string) []picker.MenuItem {
	private := questionChoice(publishPrivateID, "Keep this code private")
	private.Value = name
	public := questionChoice(publishPublicID, "Public")
	public.Value = name
	return []picker.MenuItem{
		questionBody("Publish " + name + " to GitHub as:"),
		private,
		public,
		cancelChoice(),
	}
}

func (m *Mission) emitPublish(name string, private bool) tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:publish", Payload: mustPayload(publishPayload{Name: name, Private: private})})
}
