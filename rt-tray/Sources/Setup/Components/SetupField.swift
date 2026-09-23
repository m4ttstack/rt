import SwiftUI

/// The setup wizard's one field layout: a label over the control, then at most one caption.
/// Used instead of a grouped Form row, which puts the label left and shrinks the control to a borderless strip.
struct SetupField<Content: View>: View {
    let label: String
    var note: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.callout.weight(.medium))
            content
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
    }
}
