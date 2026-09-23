import SwiftUI
import MattstackCore

struct ConnectSheet: View {
    let title: String
    let fields: [ActionField]
    let alternatives: [ActionAlternative]
    let onSubmit: ([String: String]?, String?) -> Void   // (values, alternativeId)
    @State private var values: [String: String] = [:]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connect \(title)").font(.headline)
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
