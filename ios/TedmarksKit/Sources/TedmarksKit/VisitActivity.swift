import Foundation
#if os(iOS)
import ActivityKit
#endif

/// Data shown by the visit Live Activity (Figma 03). Plain values only — the widget
/// extension renders it without touching the database.
public struct VisitActivityContent: Codable, Hashable, Sendable {
    public struct Dish: Codable, Hashable, Sendable, Identifiable {
        public var id: String          // VisitItem id
        public var name: String
        /// "😍", "👎/😍" when we disagree, nil when not rated yet.
        public var badge: String?

        public init(id: String, name: String, badge: String?) {
            self.id = id
            self.name = name
            self.badge = badge
        }
    }

    public var dishes: [Dish]
    public var ratedCount: Int
    public var verdictEmoji: String?

    public init(dishes: [Dish], ratedCount: Int, verdictEmoji: String?) {
        self.dishes = dishes
        self.ratedCount = ratedCount
        self.verdictEmoji = verdictEmoji
    }

    public var nextUnrated: Dish? { dishes.first { $0.badge == nil } }
    public var totalCount: Int { dishes.count }
}

#if os(iOS)
public struct VisitActivityAttributes: ActivityAttributes, Sendable {
    public typealias ContentState = VisitActivityContent

    public var visitId: String
    public var placeName: String
    public var participants: String
    public var startedAt: Date

    public init(visitId: String, placeName: String, participants: String, startedAt: Date) {
        self.visitId = visitId
        self.placeName = placeName
        self.participants = participants
        self.startedAt = startedAt
    }
}
#endif

/// Deep links used by the Live Activity and notifications.
public enum TedmarksLink {
    public static func rateDish(visitId: UUID, itemId: String? = nil) -> URL {
        var components = URLComponents(string: "tedmarks://rate-dish")!
        components.queryItems = [URLQueryItem(name: "visit", value: visitId.uuidString)]
            + (itemId.map { [URLQueryItem(name: "item", value: $0)] } ?? [])
        return components.url!
    }

    public static func wrapUp(visitId: UUID) -> URL {
        var components = URLComponents(string: "tedmarks://wrap-up")!
        components.queryItems = [URLQueryItem(name: "visit", value: visitId.uuidString)]
        return components.url!
    }
}
