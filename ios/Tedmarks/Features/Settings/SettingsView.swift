import SwiftUI
import TedmarksKit

struct SettingsView: View {
    @AppStorage(NearbySearchSettings.radiusKey) private var radiusMeters = NearbySearchSettings.defaultRadiusMeters

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

                Section("Account") {
                    Text("Sign in with Apple — not set up yet")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
