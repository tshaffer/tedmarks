import Foundation

/// Start visit nearby search distances. Mirrors UserSettings.nearbySearch in shared/src/schema/settings.ts.
/// Stored on the phone for now (UserDefaults); moves into synced UserSettings with sign-in.
public enum NearbySearchSettings {
    public static let startKey = "nearbySearch.startMeters"
    public static let maxKey = "nearbySearch.maxMeters"

    public static let defaultStartMeters = 402   // ≈ 0.25 mi
    public static let defaultMaxMeters = 8_047    // ≈ 5 mi

    public struct Option: Hashable, Sendable, Identifiable {
        public let meters: Int
        public let label: String
        public var id: Int { meters }
    }

    private static func miles(_ miles: Double, _ label: String) -> Option {
        Option(meters: Int((miles * 1_609.344).rounded()), label: label)
    }

    /// "Search within"
    public static let startOptions: [Option] = [
        miles(0.1, "0.1 mile"), miles(0.25, "¼ mile"), miles(0.5, "½ mile"), miles(1, "1 mile"),
    ]

    /// "If nothing's found, widen up to" — `nil` meters means don't widen.
    public static let maxOptions: [Option?] = [
        nil, miles(1, "1 mile"), miles(2, "2 miles"), miles(5, "5 miles"), miles(10, "10 miles"), miles(25, "25 miles"),
    ]

    /// Effective (start, max) for a request; max never below start. A stored max of 0 means "don't widen".
    public static func range(startMeters: Int, maxMeters: Int) -> (start: Int, max: Int) {
        (startMeters, maxMeters == 0 ? startMeters : max(maxMeters, startMeters))
    }
}
