import SwiftUI
import MattstackCore

struct ConnectSheet: View {
    let title: String
    let fields: [ActionField]
    let alternatives: [ActionAlternative]
    let create: ActionLink?
    let onSubmit: ([String: String]?, String?) -> Void   // (values, alternativeId)
    @State private var values: [String: String]
    @Environment(\.dismiss) private var dismiss

    init(title: String, fields: [ActionField], alternatives: [ActionAlternative], create: ActionLink? = nil,
         onSubmit: @escaping ([String: String]?, String?) -> Void) {
        self.title = title; self.fields = fields; self.alternatives = alternatives; self.create = create; self.onSubmit = onSubmit
        var prefilled: [String: String] = [:]
        for f in fields { if let v = f.value, !v.isEmpty { prefilled[f.name] = v } }
        _values = State(initialValue: prefilled)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connect \(title)").font(.headline)
            if let create, let url = URL(string: create.url) {
                Button(create.label) { NSWorkspace.shared.open(url) }
                    .buttonStyle(.link)
                    .accessibilityIdentifier(AXID.connectCreate)
            }
            ForEach(fields, id: \.name) { f in
                SetupField(label: f.label, note: f.hint) {
                    Group {
                        if f.secret {
                            SecureField("", text: binding(f.name))
                        } else {
                            TextField("", text: binding(f.name))
                        }
                    }
                    .labelsHidden()
                    .accessibilityLabel(f.label)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier(AXID.connectField(f.name))
                }
            }
            HStack {
                ForEach(alternatives, id: \.id) { alt in
                    Button(alt.label) { onSubmit(nil, alt.id); dismiss() }.accessibilityIdentifier(AXID.connectAlternative(alt.id))
                }
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).accessibilityIdentifier(AXID.connectCancel)
                Button("Connect") { onSubmit(values, nil); dismiss() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(fields.contains { (values[$0.name] ?? "").isEmpty })
                    .accessibilityIdentifier(AXID.connectSubmit)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func binding(_ name: String) -> Binding<String> {
        Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
    }
}
