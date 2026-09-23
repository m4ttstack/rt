import SwiftUI
import MattstackCore

/// One list of choices plus an optional free-text id. `onChoose` runs the
/// verb and returns nil or the failure copy, which stays in the sheet.
struct ChooseSheet: View {
    let title: String
    let options: [ChooseOption]
    let other: ChooseOther?
    let onChoose: (String) async -> String?
    @State private var selection: String?
    @State private var ownId = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(title: String, options: [ChooseOption], selected: String?, other: ChooseOther?, onChoose: @escaping (String) async -> String?) {
        self.title = title
        self.options = options
        self.other = other
        self.onChoose = onChoose
        // A current value that is not a listed option (a personal skill picked by id) opens in the own-skill field.
        if let selected, options.contains(where: { $0.id == selected }) {
            _selection = State(initialValue: selected)
        } else if let selected {
            _ownId = State(initialValue: selected)
        }
    }

    private var chosenId: String? {
        let own = ownId.trimmingCharacters(in: .whitespacesAndNewlines)
        return own.isEmpty ? selection : own
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            List(options, id: \.id, selection: $selection) { o in
                VStack(alignment: .leading, spacing: 3) {
                    Text(o.label).font(.body.weight(.medium))
                    Text(o.detail).font(.caption).foregroundStyle(.secondary)
                    if let s = o.sample {
                        Text(s).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
                .padding(.vertical, 4)
                .tag(o.id)
                .accessibilityIdentifier(AXID.chooseOption(o.id))
            }
            .frame(minHeight: 220)
            // Picking a listed style clears the typed id and typing clears the pick, so what is highlighted is what gets saved.
            .onChange(of: selection) { _, new in if new != nil { ownId = "" } }
            if let other {
                VStack(alignment: .leading, spacing: 2) {
                    TextField(other.label, text: $ownId)
                        .onChange(of: ownId) { _, new in if !new.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { selection = nil } }
                        .accessibilityIdentifier(AXID.chooseOther)
                    Text(other.hint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(AXID.chooseError)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy).accessibilityIdentifier(AXID.chooseCancel)
                Button(busy ? "Saving…" : "Use this style") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || chosenId == nil)
                    .accessibilityIdentifier(AXID.chooseSubmit)
            }
        }
        .padding(20)
        .frame(width: 480)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.chooseSheet)
    }

    private func submit() {
        guard let id = chosenId else { return }
        busy = true
        error = nil
        Task {
            let failure = await onChoose(id)
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}
