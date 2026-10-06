import SwiftUI
import TedmarksKit

/// Settings → Sync: when this phone last synced with the server, any problem, and Sync now.
struct SyncSection: View {
    private var engine: SyncEngine { SyncEngine.shared }

    var body: some View {
        Section {
            HStack {
                Text("Last synced")
                Spacer()
                if engine.isSyncing {
                    ProgressView()
                } else if let lastSyncedAt = engine.lastSyncedAt {
                    Text(lastSyncedAt, format: .relative(presentation: .named)).foregroundStyle(.secondary)
                } else {
                    Text("Never").foregroundStyle(.secondary)
                }
            }
            if let error = engine.lastError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.subheadline).foregroundStyle(.orange)
            }
            if !engine.rejected.isEmpty {
                DisclosureGroup("\(engine.rejected.count) record\(engine.rejected.count == 1 ? "" : "s") the server refused") {
                    ForEach(engine.rejected, id: \.id) { record in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.collection).font(.caption.weight(.semibold))
                            Text(record.reason).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .font(.subheadline)
            }
            Button("Sync now") {
                Task { await engine.sync() }
            }
            .disabled(engine.isSyncing)
        } header: {
            Text("Sync")
        } footer: {
            Text("Visits, dishes and ratings are saved to the Tedmarks server whenever you change them, so they're safe if this phone is lost and will show up on the web.")
        }
    }
}
