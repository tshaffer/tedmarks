import SwiftUI
import TedmarksKit

struct SettingsView: View {
    #if DEBUG
    @State private var testPromptStatus: String?
    #endif
    @AppStorage(NearbySearchSettings.radiusKey) private var radiusMeters = NearbySearchSettings.defaultRadiusMeters
    @AppStorage(VisitPromptSettings.delayKey) private var promptDelayMinutes = VisitPromptSettings.defaultDelayMinutes

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Search radius", selection: $radiusMeters) {
                        ForEach(NearbySearchSettings.options) { option in
                            Text(option.label).tag(option.meters)
                        }
                    }
                } header: {
                    Text("Start visit search")
                } footer: {
                    Text("How far to look for restaurants when you start a visit. The nearest ones are listed first.")
                }

                Section {
                    Picker("Ask \"How was it?\" after", selection: $promptDelayMinutes) {
                        ForEach(VisitPromptSettings.options, id: \.self) { minutes in
                            Text(minutes % 60 == 0 ? "\(minutes / 60) hour\(minutes == 60 ? "" : "s")" : "\(minutes / 60)½ hours")
                                .tag(minutes)
                        }
                    }
                } header: {
                    Text("Reminder")
                } footer: {
                    Text("If a visit has no verdict yet, one notification is sent this long after it started. Press and hold it to answer with one tap.")
                }

                #if DEBUG
                Section {
                    Button("Send test prompt in 10 seconds") {
                        Task { testPromptStatus = await VisitPrompt.sendTest(in: TedmarksStore.context) }
                    }
                    if let testPromptStatus {
                        Text(testPromptStatus).font(.footnote).foregroundStyle(.secondary)
                    }
                    NavigationLink("Lock Screen tap log") { ActionLogView() }
                } header: {
                    Text("Testing (debug builds only)")
                } footer: {
                    Text("Needs an active visit. Long-press the notification for the verdict buttons. The tap log shows what Live Activity and notification buttons did.")
                }
                #endif

                SyncSection()

                Section("Account") {
                    Text("Sign in with Apple — not set up yet")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#if DEBUG
/// What Live Activity / notification taps did, newest first (debug builds).
struct ActionLogView: View {
    @State private var entries = ActionLog.entries

    var body: some View {
        List {
            if entries.isEmpty {
                Text("No taps recorded yet.").foregroundStyle(.secondary)
            }
            ForEach(entries, id: \.self) { Text($0).font(.footnote.monospaced()) }
        }
        .navigationTitle("Tap log")
        .refreshable { entries = ActionLog.entries }
        .onAppear { entries = ActionLog.entries }
    }
}
#endif
