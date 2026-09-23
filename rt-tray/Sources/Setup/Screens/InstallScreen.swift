import SwiftUI
import MattstackCore

struct InstallScreen: View {
    @ObservedObject var model: InstallRunModel
    @State private var logFor: InstallStep?
    @State private var showNotes = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                Form {
                    Section {
                        ForEach(model.steps) { step in stepRow(step).id(step.id) }
                    } header: {
                        Text(headerText)
                    }
                }
                .formStyle(.grouped)
                // The list outgrows the window, so the step in play (and a failure's Retry) would otherwise sit below the fold.
                .onChange(of: focusStepId) { _, id in
                    guard let id else { return }
                    withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
                }
            }
            if !model.streamNotes.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "info.circle").foregroundStyle(.secondary)
                    Text("\(model.streamNotes.count) diagnostic note\(model.streamNotes.count == 1 ? "" : "s")")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("View") { showNotes = true }.controlSize(.small).accessibilityIdentifier(AXID.installNotes)
                }
                .padding(.horizontal, 20).padding(.vertical, 4)
            }
            if case .streamError(let e) = model.phase {
                HStack {
                    Label("Install stopped: \(e)", systemImage: "xmark.circle").foregroundStyle(.red).font(.callout)
                    Spacer()
                    Button("Retry") { model.retryFromFailure() }.accessibilityIdentifier(AXID.installRetryStream)
                }
                .padding(.horizontal, 20).padding(.vertical, 8)
            }
        }
        .sheet(item: $logFor) { s in LogSheet(title: s.info.title, lines: model.logLines(for: s.id)) }
        .sheet(isPresented: $showNotes) { LogSheet(title: "Diagnostic notes", lines: model.streamNotes) }
        // .contain: without it, the "View"/"Retry" buttons in the plain
        // HStacks below the Form report THIS screen-level identifier instead
        // of their own -- same fix as stepRow and ChecklistScreen.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.installScreen)
    }

    private var focusStepId: String? {
        model.failedStepId ?? model.steps.first { $0.state == .running }?.id
    }

    private var headerText: String {
        switch model.phase {
        case .idle: return "Ready to install."
        case .running: return "Installing… nothing runs that isn't listed here."
        case .succeeded: return "Installed."
        case .failed(let id, _): return "Stopped at: \(model.steps.first { $0.id == id }?.info.title ?? id)"
        case .streamError: return "Install stopped."
        }
    }

    @ViewBuilder
    private func stepRow(_ step: InstallStep) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                StatusBadge(status: badge(step), id: AXID.installStepStatus(step.id))
                VStack(alignment: .leading, spacing: 2) {
                    Text(step.info.title)
                    if step.waitingOnYou {
                        Text(step.info.kind == .privileged ? "Waiting for you — an administrator prompt is open." : "Waiting for you — approve mattstack in Login Items if asked.")
                            .font(.caption).foregroundStyle(.orange)
                    } else if let d = step.detail, !d.isEmpty {
                        Text(d).font(.caption).foregroundStyle(step.state == .failed ? .red : .secondary)
                    }
                }
                Spacer()
                if !model.logLines(for: step.id).isEmpty {
                    if step.state == .failed {
                        Button("Show log") { logFor = step }.controlSize(.small).accessibilityIdentifier(AXID.installStepLog(step.id))
                    } else {
                        Button { logFor = step } label: { Label("Show log", systemImage: "doc.text").labelStyle(.iconOnly) }
                            .buttonStyle(.borderless).foregroundStyle(.secondary).help("Show log")
                            .accessibilityIdentifier(AXID.installStepLog(step.id))
                    }
                }
            }
            if step.state == .failed, model.failedStepId == step.id {
                HStack(alignment: .top) {
                    if let r = step.remedy { Text(r).font(.callout).fixedSize(horizontal: false, vertical: true) }
                    Spacer()
                    Button("Retry from here") { model.retryFromFailure() }
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier(AXID.installRetry)
                }
                // 20pt badge + 10pt spacing: the remedy starts under the step title.
                .padding(.leading, 30)
                .padding(.top, 2)
            }
        }
        // .contain: without it, AppKit collapses the row into one element and
        // every child (status badge, "Show log", "Retry from here") reports
        // THIS identifier instead of its own -- the row-level id and each
        // control's own id both need to resolve independently.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.installStep(step.id))
    }

    private func badge(_ step: InstallStep) -> RowStatus {
        switch step.state {
        case .pending: return .skipped
        case .running: return step.waitingOnYou ? .needsYou : .checking
        case .done: return .ready
        case .failed: return .error
        case .skipped: return .skipped
        case .unknown: return .error
        }
    }
}
