import Foundation

/// Start visit nearby search radius. Mirrors UserSettings.nearbyRadiusMeters in shared/src/schema/settings.ts.
/// Stored on the phone for now (UserDefaults); moves into synced UserSettings with sign-in.
public enum NearbySearchSettings {
    public static let radiusKey = "nearbySearch.radiusMeters"

    public struct Option: Hashable, Sendable, Identifiable {
        public let meters: Int
        public let label: String
        public var id: Int { meters }
    }

    private static func miles(_ miles: Double, _ label: String) -> Option {
        Option(meters: Int((miles * 1_609.344).rounded()), label: label)
    }

    public static let options: [Option] = [
        miles(1, "1 mile"), miles(5, "5 miles"), miles(20, "20 miles"),
    ]

    public static let defaultRadiusMeters = options[0].meters   // 1 mile

    /// The saved radius, or the default if none (or an old/unknown value) is saved.
    public static func radius(from defaults: UserDefaults = .standard) -> Int {
        let saved = defaults.object(forKey: radiusKey) as? Int
        return options.contains { $0.meters == saved } ? saved! : defaultRadiusMeters
    }
}
