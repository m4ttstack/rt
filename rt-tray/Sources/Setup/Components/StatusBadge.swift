import SwiftUI
import MattstackCore

struct StatusBadge: View {
    let status: RowStatus
    var id: String? = nil
    var body: some View {
        let symbol = StatusGlyph.symbol(for: status)
        let badge = Group {
            if symbol == "progress" {
                ProgressView().controlSize(.small)
            } else if StatusGlyph.multicolor(for: status) {
                Image(systemName: symbol).symbolRenderingMode(.multicolor)
            } else {
                Image(systemName: symbol).foregroundStyle(color)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityLabel(Text(status.rawValue))
        .accessibilityValue(Text(status.rawValue))
        if let id {
            badge.accessibilityIdentifier(id)
        } else {
            badge
        }
    }
    /// Only reached when `!StatusGlyph.multicolor(for: status)`, which is exactly
    /// the statuses whose tint is never `.yellow` -- so that case cannot occur here.
    private var color: Color {
        switch StatusGlyph.tint(for: status) {
        case .green: return .green
        case .red: return .red
        case .yellow: fatalError("StatusGlyph.multicolor already renders yellow-tinted statuses before color is used")
        case .grey: return .secondary
        case .none: return .primary
        }
    }
}
