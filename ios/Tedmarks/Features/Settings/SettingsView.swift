import SwiftUI
import TedmarksKit

struct SettingsView: View {
    @AppStorage(NearbySearchSettings.startKey) private var startMeters = NearbySearchSettings.defaultStartMeters
    /// 0 = don't widen.
    @AppStorage(NearbySearchSettings.maxKey) private var maxMeters = NearbySearchSettings.defaultMaxMeters

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Search within", selection: $startMeters) {
                        ForEach(NearbySearchSettings.startOptions) { option in
                            Text(option.label).tag(option.meters)
                        }
                    }
                    Picker("If nothing's found, widen up to", selection: $maxMeters) {
                        ForEach(NearbySearchSettings.maxOptions, id: \.self) { option in
                            Text(option?.label ?? "Don't widen").tag(option?.meters ?? 0)
                        }
                    }
                } header: {
                    Text("Start visit search")
                } footer: {
                    Text("How far to look for restaurants when you start a visit. If none are found, the search widens step by step up to the second distance.")
                }

                Section("Account") {
                    Text("Sign in with Apple — not set up yet")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
