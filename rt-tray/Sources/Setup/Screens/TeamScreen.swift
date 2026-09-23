import SwiftUI
import MattstackCore

struct TeamScreen: View {
    @ObservedObject var model: TeamChoiceModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                card(.create, title: "Create a team", systemImage: "person.3") { createFields }
                card(.join, title: "Join a team", systemImage: "person.crop.circle.badge.plus") { joinFields }
                card(.restore, title: "Already have mattstack settings?", systemImage: "arrow.counterclockwise.icloud", compact: true) { restoreFields }
            }
            .padding(20)
        }
        .task { await model.loadGitHubStatus() }
        .accessibilityIdentifier(AXID.teamScreen)
    }

    @ViewBuilder
    private func card<Content: View>(_ choice: TeamChoice, title: String, systemImage: String, compact: Bool = false,
                                     @ViewBuilder content: () -> Content) -> some View {
        let selected = model.choice == choice
        VStack(alignment: .leading, spacing: 14) {
            Button { model.choice = choice } label: {
                HStack(spacing: 8) {
                    Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                        .frame(width: 16)
                    Label(title, systemImage: systemImage).font(compact ? .body : .headline)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(cardID(choice))
            .accessibilityAddTraits(selected ? [.isSelected] : [])
            // 16pt radio + 8pt spacing: the fields start under the title's icon.
            if selected {
                VStack(alignment: .leading, spacing: 14) { content() }
                    .padding(.leading, 24)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? Color.accentColor : Color.clear, lineWidth: 1))
    }

    private func cardID(_ c: TeamChoice) -> String {
        switch c { case .create: return AXID.teamCardCreate; case .join: return AXID.teamCardJoin; case .restore: return AXID.teamCardRestore }
    }

    private func field<Content: View>(_ label: String, note: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.callout.weight(.medium))
            content()
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
    }

    private func switchRow(_ label: String, isOn: Binding<Bool>, id: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Toggle(label, isOn: isOn).toggleStyle(.switch).controlSize(.small).labelsHidden().accessibilityIdentifier(id)
        }
    }

    private var createFields: some View {
        Group {
            field("Team name", note: model.slugPreview.isEmpty ? nil : "Slug: \(model.slugPreview)") {
                TextField("Team name", text: $model.teamName, prompt: Text("Acme")).labelsHidden().accessibilityIdentifier(AXID.teamCreateName)
            }
            switchRow("Others will join later", isOn: $model.othersWillJoin, id: AXID.teamCreateOthers)
            if model.ghHandle != nil {
                switchRow("Create a private GitHub repo \(model.ghRepoPreview)", isOn: $model.useGhRepo, id: AXID.teamCreateUseGh)
                if model.useGhRepo {
                    field("Owner") {
                        Picker("Owner", selection: Binding(get: { model.ghOwner ?? "" }, set: { model.ghOwner = $0 })) {
                            ForEach(model.ghOwners, id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden().fixedSize()
                        .accessibilityIdentifier(AXID.teamCreateOwner)
                    }
                }
            }
            if !model.useGhRepo {
                field("Repository URL", note: TeamChoiceModel.explainer) {
                    TextField("Repository URL", text: $model.remoteURL, prompt: Text("An empty repo: GitHub, GitLab, anything git can push to"))
                        .labelsHidden().accessibilityIdentifier(AXID.teamCreateRemote)
                }
            }
            if model.isChecking { checkingRow }
        }
    }

    private var joinFields: some View {
        Group {
            field("Invite code", note: "Paste the whole code or the mattstack://join link you were sent. macOS may ask to read your clipboard.") {
                HStack(alignment: .top, spacing: 8) {
                    // .roundedBorder never wraps on macOS, and a 77-character code must stay readable whole.
                    TextField("Invite code", text: $model.inviteCode, prompt: Text("XXXX-XXXX-…"), axis: .vertical)
                        .labelsHidden()
                        .textFieldStyle(.plain)
                        .lineLimit(1...3)
                        .font(.system(.body, design: .monospaced))
                        .padding(.horizontal, 6).padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 5).fill(Color(nsColor: .textBackgroundColor)))
                        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color(nsColor: .separatorColor)))
                        .accessibilityIdentifier(AXID.teamJoinCode)
                    Button("Paste") { model.pasteInvite() }
                        .accessibilityIdentifier(AXID.teamPasteInvite)
                }
            }
            if let s = model.joinSummary { Label(s, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            if let w = model.joinWarning { Label(w, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).accessibilityIdentifier(AXID.teamJoinWarning) }
            if model.isChecking { checkingRow }
        }
    }

    private var restoreFields: some View {
        Group {
            field("Home repo") {
                TextField("Home repo", text: $model.restoreRepo, prompt: Text("<org>/<repo>")).labelsHidden().accessibilityIdentifier(AXID.teamRestoreRepo)
            }
            field("Age key", note: "Clones your settings to ~/.mattstack, installs the key in the Keychain, and replays your teams and packs during Install.") {
                SecureField("Age key", text: $model.restoreAgeKey, prompt: Text("From your password manager")).labelsHidden().accessibilityIdentifier(AXID.teamRestoreKey)
            }
            if model.isChecking { checkingRow }
        }
    }

    private var checkingRow: some View {
        HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text("Checking with rt…").font(.caption).foregroundStyle(.secondary)
        }
    }
}
