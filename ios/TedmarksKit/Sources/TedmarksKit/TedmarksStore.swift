import Foundation
import SwiftData

/// The one SwiftData store, in the App Group container so the app, the widget extension,
/// Live Activity buttons and notification actions all see the same data.
@MainActor
public enum TedmarksStore {
    public nonisolated static let appGroupId = "group.com.tedshaffer.tedmarks"

    public static let container: ModelContainer = {
        do {
            let configuration: ModelConfiguration
            if let url = storeURL {
                migrateLegacyStoreIfNeeded(to: url)
                configuration = ModelConfiguration(url: url)
            } else {
                configuration = ModelConfiguration()   // App Group unavailable (e.g. tests): default location
            }
            let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: configuration)
            try VisitStarter.ensureHousehold(in: container.mainContext)
            return container
        } catch {
            fatalError("Could not open the Tedmarks database: \(error)")
        }
    }()

    public static var context: ModelContext { container.mainContext }

    static var storeURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appending(path: "Library/Application Support/Tedmarks.store")
    }

    /// Earlier builds kept the store in the app's own Application Support ("default.store").
    /// Copy it (and its -shm/-wal files) into the App Group once, so existing visits carry over.
    private static func migrateLegacyStoreIfNeeded(to url: URL) {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: url.path),
              let legacyDir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return }
        let legacy = legacyDir.appending(path: "default.store")
        guard fm.fileExists(atPath: legacy.path) else { return }
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        for suffix in ["", "-shm", "-wal"] {
            let from = URL(fileURLWithPath: legacy.path + suffix)
            let to = URL(fileURLWithPath: url.path + suffix)
            if fm.fileExists(atPath: from.path) { try? fm.copyItem(at: from, to: to) }
        }
    }
}

/// Shared defaults (App Group) — readable by the app and the widget extension.
public enum SharedDefaults {
    public static var suite: UserDefaults { UserDefaults(suiteName: TedmarksStore.appGroupId) ?? .standard }
}

/// Records what Live Activity / notification taps did (shown in Settings → Testing, debug builds).
public enum ActionLog {
    private static let key = "actionLog"

    public static func record(_ message: String) {
        let process = Bundle.main.bundleIdentifier?.components(separatedBy: ".").last ?? "?"
        let stamp = Date.now.formatted(date: .omitted, time: .standard)
        var entries = SharedDefaults.suite.stringArray(forKey: key) ?? []
        entries.insert("\(stamp) [\(process)] \(message)", at: 0)
        SharedDefaults.suite.set(Array(entries.prefix(15)), forKey: key)
    }

    public static var entries: [String] { SharedDefaults.suite.stringArray(forKey: key) ?? [] }
}
