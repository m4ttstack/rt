import SwiftUI
import MattstackCore

/// A choose row's options as selectable cards, plus an optional card that
/// reveals a free-text id. `onChoose` runs the verb and returns nil or the
/// failure copy, which stays in the sheet.
struct ChooseSheet: View {
    let title: String
    let subtitle: String?
    let options: [ChooseOption]
    let other: ChooseOther?
    let footnote: String?
    let onChoose: (String) async -> String?

    private enum Choice: Hashable { case option(String), own }

    @State private var choice: Choice?
    @State private var ownId = ""
    @State private var busy = false
    @State private var error: String?
    @State private var suggestionsOpen = false
    @State private var pickedSuggestion = false
    @FocusState private var ownFocused: Bool
    @Environment(\.dismiss) private var dismiss

    init(row: PlanRow, onChoose: @escaping (String) async -> String?) {
        let action = row.action
        self.title = row.title
        self.subtitle = action?.subtitle
        self.options = action?.options ?? []
        self.other = action?.other
        self.footnote = action?.footnote
        self.onChoose = onChoose
        // A current value that is not a listed option (a skill picked by id) opens on the own-skill card.
        if let selected = action?.selected {
            if options.contains(where: { $0.id == selected }) {
                _choice = State(initialValue: .option(selected))
            } else if action?.other != nil {
                _choice = State(initialValue: .own)
                _ownId = State(initialValue: selected)
            }
        }
    }

    private var chosenId: String? {
        switch choice {
        case .option(let id): return id
        case .own:
            let own = ownId.trimmingCharacters(in: .whitespacesAndNewlines)
            return own.isEmpty ? nil : own
        case nil: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(24)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(options, id: \.id) { optionCard($0) }
                        if let other { ownCard(other).id(Choice.own) }
                    }
                    .padding(24)
                }
                .onChange(of: choice) { _, new in
                    if new == .own { withAnimation { proxy.scrollTo(Choice.own, anchor: .bottom) } }
                }
            }
            .frame(maxHeight: 420)
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24).padding(.bottom, 12)
                    .accessibilityIdentifier(AXID.chooseError)
            }
            Divider()
            footer.padding(.horizontal, 24).padding(.vertical, 16)
        }
        .frame(width: 560)
        // The cards use the Team screen's control-background fill, which only reads against the window background.
        .background(Color(nsColor: .windowBackgroundColor))
        // Hosted at the sheet's root so the dropdown floats over the scroll view's edge and the buttons
        // without taking layout space: nothing around the field moves when it opens or closes.
        .overlayPreferenceValue(OwnFieldBounds.self) { anchor in
            GeometryReader { proxy in
                if suggestionsOpen, let anchor, !ownMatches.isEmpty {
                    let field = proxy[anchor]
                    ZStack(alignment: .topLeading) {
                        Color.clear.contentShape(Rectangle()).onTapGesture { suggestionsOpen = false }
                        SuggestionList(matches: ownMatches, pick: pickSuggestion)
                            .frame(width: field.width)
                            .offset(x: field.minX, y: field.maxY + 4)
                    }
                }
            }
            .allowsHitTesting(suggestionsOpen)
        }
        .onChange(of: choice) { _, new in
            error = nil
            suggestionsOpen = false
            ownFocused = new == .own
        }
        .onChange(of: ownId) { _, _ in
            error = nil
            if pickedSuggestion { pickedSuggestion = false; return }
            suggestionsOpen = ownFocused && !ownMatches.isEmpty
        }
        .onChange(of: ownFocused) { _, focused in if !focused { suggestionsOpen = false } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.chooseSheet)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "text.bubble")
                .font(.system(size: 28))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title2.bold())
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func optionCard(_ o: ChooseOption) -> some View {
        let selected = choice == .option(o.id)
        return card(selected: selected, id: AXID.chooseOption(o.id), select: { choice = .option(o.id) }) {
            VStack(alignment: .leading, spacing: 4) {
                Text(o.label).font(.headline)
                Text(o.detail).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } content: {
            if let sample = o.sample {
                Text(LocalizedStringKey(sample))
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.15)))
            }
        }
    }

    private func ownCard(_ other: ChooseOther) -> some View {
        let selected = choice == .own
        return card(selected: selected, id: AXID.chooseOwn, select: { choice = .own }) {
            Text(other.label).font(.headline)
        } content: {
            if selected {
                SetupField(label: "Skill id", note: other.hint) {
                    TextField(other.label, text: $ownId, prompt: Text("plugin:skill-name"))
                        .labelsHidden()
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .focused($ownFocused)
                        .onSubmit(submit)
                        .onKeyPress(.escape) {
                            guard suggestionsOpen else { return .ignored }
                            suggestionsOpen = false
                            return .handled
                        }
                        .anchorPreference(key: OwnFieldBounds.self, value: .bounds) { $0 }
                        .accessibilityLabel(other.label)
                        .accessibilityIdentifier(AXID.chooseOther)
                }
            }
        }
    }

    private var ownMatches: [String] {
        ChooseSuggestions.matching(ownId, in: other?.suggestions ?? [])
    }

    private func pickSuggestion(_ id: String) {
        pickedSuggestion = true
        suggestionsOpen = false
        ownId = id
    }

    private func card<Title: View, Content: View>(selected: Bool, id: String, select: @escaping () -> Void,
                                                  @ViewBuilder title: () -> Title,
                                                  @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: select) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                        .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                        .padding(.top, 2)
                    title()
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(id)
            .accessibilityAddTraits(selected ? [.isSelected] : [])
            content().padding(.leading, 24)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? Color.accentColor : Color.clear, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { if !selected { select() } }
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            if let footnote {
                Text(footnote).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .disabled(busy)
                .accessibilityIdentifier(AXID.chooseCancel)
            Button(busy ? "Saving…" : "Use this style") { submit() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(busy || chosenId == nil)
                .accessibilityIdentifier(AXID.chooseSubmit)
        }
    }

    private func submit() {
        guard let id = chosenId, !busy else { return }
        busy = true
        error = nil
        Task { @MainActor in
            let failure = await onChoose(id)
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}

private struct OwnFieldBounds: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) { value = value ?? nextValue() }
}

private struct SuggestionList: View {
    let matches: [String]
    let pick: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(matches, id: \.self) { s in SuggestionRow(id: s) { pick(s) } }
            }
            .padding(4)
        }
        // Short lists size to fit; long ones scroll past about six rows so every match stays reachable.
        .frame(height: min(CGFloat(matches.count) * SuggestionRow.height + 8, 6.5 * SuggestionRow.height + 8))
        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
        .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
    }
}

private struct SuggestionRow: View {
    static let height: CGFloat = 24
    let id: String
    let pick: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: pick) {
            Text(id).font(.system(.callout, design: .monospaced))
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, minHeight: Self.height, maxHeight: Self.height, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? Color.secondary.opacity(0.3) : Color.clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityIdentifier(AXID.chooseSuggestion(id))
    }
}
