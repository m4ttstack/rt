import SwiftUI
import MattstackCore

struct WorktreePanelView: View {
    @StateObject private var controller = WorktreePanelController()
    var body: some View {
        List(controller.rows) { row in Text("\(row.tree): \(row.verdict)") }
            .onAppear { controller.startPolling() }
            .onDisappear { controller.stopPolling() }
    }
}
