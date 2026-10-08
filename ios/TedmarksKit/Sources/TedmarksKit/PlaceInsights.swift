import Foundation
import SwiftData

/// How the Places list is filtered and ordered.
public enum PlaceFilter: String, CaseIterable, Sendable {
    case beenThere, wantToGo, all

    public var label: String {
        switch self {
        case .beenThere: "Been there"
        case .wantToGo: "Want to go"
        case .all: "All"
        }
    }
}

public enum PlaceSort: String, CaseIterable, Sendable {
    case nearest, name, recentVisit

    public var label: String {
        switch self {
        case .nearest: "Nearest"
        case .name: "Name"
        case .recentVisit: "Last visited"
        }
    }
}

/// One row of the Places list.
public struct PlaceSummary: Identifiable {
    public let place: Place
    public let visitCount: Int
    public let lastVisitAt: Date?
    /// The verdict from the most recent visit that has one.
    public let verdict: RatingDisplay<VerdictValue>
    public var id: UUID { place.id }
}

/// A dish on the Place page: which group it's in ("Order again", "Skip"…), how we rated it
/// on each visit (newest first), and its comments.
public struct DishSummary: Identifiable {
    public let item: PlaceItem
    public let group: WhatToOrderGroup
    public let ratings: [RatingDisplay<ItemRatingValue>]
    public let comments: [String]
    public let timesOrdered: Int
    public var id: UUID { item.id }
    /// The most recent rating, for the badge.
    public var latest: RatingDisplay<ItemRatingValue> { ratings.first { $0 != .none } ?? .none }
}

/// What the Places tab and Place page show, computed from synced records
/// ("joint unless we disagree" and "what to order" come from the shared rules).
@MainActor
public struct PlaceInsights {
    private let ratingsBySubject: [UUID: [Rating]]
    private let notesByItem: [UUID: [Note]]
    private let householdIds: Set<UUID>

    /// Fetches all live ratings, notes and people once, so a whole list is cheap to summarize.
    public init(context: ModelContext) throws {
        let ratings = try context.fetch(FetchDescriptor<Rating>(predicate: #Predicate { $0.deletedAt == nil }))
        ratingsBySubject = Dictionary(grouping: ratings, by: \.subjectId)
        let notes = try context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.deletedAt == nil }))
        notesByItem = Dictionary(grouping: notes.filter { $0.visitItemId != nil }, by: { $0.visitItemId! })
        let people = try context.fetch(FetchDescriptor<Person>())
        householdIds = Set(people.filter { $0.kind == .household && $0.deletedAt == nil }.map(\.id))
    }

    /// Ended or in-progress visits that weren't deleted, newest first.
    public static func visits(at place: Place) -> [Visit] {
        place.visits.filter { $0.deletedAt == nil }.sorted { $0.startedAt > $1.startedAt }
    }

    public func verdict(for visit: Visit) -> RatingDisplay<VerdictValue> {
        DishCapture.display(ratingsBySubject[visit.id] ?? [], household: household(visit), as: VerdictValue.self)
    }

    public func summary(for place: Place) -> PlaceSummary {
        let visits = Self.visits(at: place)
        let verdict = visits.lazy.map { self.verdict(for: $0) }.first { $0 != .none } ?? .none
        return PlaceSummary(place: place, visitCount: visits.count, lastVisitAt: visits.first?.startedAt, verdict: verdict)
    }

    /// Every dish we've ordered here, grouped by the shared "what to order" rule:
    /// order again first (most loved, most ordered), then disagreements, skips, unrated.
    public func dishes(at place: Place) -> [DishSummary] {
        let visits = Self.visits(at: place)
        var linesByItem: [UUID: [VisitItem]] = [:]
        for visit in visits {
            for line in DishCapture.orderItems(for: visit) {
                if let item = line.placeItem { linesByItem[item.id, default: []].append(line) }
            }
        }
        let summaries: [DishSummary] = place.items.filter { $0.deletedAt == nil }.compactMap { item in
            let lines = linesByItem[item.id] ?? []
            guard !lines.isEmpty else { return nil }   // on a menu but never ordered
            let ratings = lines.map { line in
                DishCapture.display(ratingsBySubject[line.id] ?? [], household: household(line.visit), as: ItemRatingValue.self)
            }
            let result = whatToOrder(placeItemId: item.id.uuidString, onLatestMenu: item.onLatestMenu, displays: ratings)
            let comments = lines.flatMap { notesByItem[$0.id] ?? [] }.sorted { $0.createdAt > $1.createdAt }.map(\.text)
            return DishSummary(item: item, group: result.group, ratings: ratings, comments: comments, timesOrdered: lines.count)
        }
        return summaries.sorted { a, b in
            if a.group != b.group { return Self.groupOrder(a.group) < Self.groupOrder(b.group) }
            if Self.score(a.latest) != Self.score(b.latest) { return Self.score(a.latest) > Self.score(b.latest) }
            if a.timesOrdered != b.timesOrdered { return a.timesOrdered > b.timesOrdered }
            return a.item.name.localizedStandardCompare(b.item.name) == .orderedAscending
        }
    }

    /// Filtered by status and name (or tag), then sorted. Nearest needs `origin` (else it sorts by name).
    public func summaries(
        of places: [Place], filter: PlaceFilter, search: String, sort: PlaceSort,
        from origin: (latitude: Double, longitude: Double)?
    ) -> [PlaceSummary] {
        let query = search.trimmingCharacters(in: .whitespaces)
        let matching = places.filter { place in
            guard place.deletedAt == nil else { return false }
            switch filter {
            case .beenThere: if place.status != .beenThere { return false }
            case .wantToGo: if place.status != .wantToGo { return false }
            case .all: break
            }
            return query.isEmpty || place.name.localizedStandardContains(query) || place.tags.contains { $0.localizedStandardContains(query) }
        }
        let summaries = matching.map(summary(for:))
        let byName = { (a: PlaceSummary, b: PlaceSummary) in a.place.name.localizedStandardCompare(b.place.name) == .orderedAscending }
        switch sort {
        case .name:
            return summaries.sorted(by: byName)
        case .recentVisit:
            return summaries.sorted { a, b in
                switch (a.lastVisitAt, b.lastVisitAt) {
                case let (x?, y?) where x != y: x > y
                case (_?, nil): true
                case (nil, _?): false
                default: byName(a, b)
                }
            }
        case .nearest:
            guard let origin else { return summaries.sorted(by: byName) }
            let meters = Dictionary(uniqueKeysWithValues: summaries.map { ($0.id, Self.distanceMeters(to: $0.place, from: origin)) })
            return summaries.sorted { a, b in
                let da = meters[a.id]!, db = meters[b.id]!
                return da == db ? byName(a, b) : da < db
            }
        }
    }

    public static func distanceMeters(to place: Place, from origin: (latitude: Double, longitude: Double)) -> Double {
        let radians = { (degrees: Double) in degrees * .pi / 180 }
        let dLat = radians(place.latitude - origin.latitude)
        let dLon = radians(place.longitude - origin.longitude)
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(radians(origin.latitude)) * cos(radians(place.latitude)) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000 * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /// "Mountain View" from "160 Castro St, Mountain View, CA 94041, USA".
    public static func city(of place: Place) -> String? {
        let parts = (place.googleAddress ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return parts.count >= 3 ? parts[parts.count - 3] : nil
    }

    // MARK: - Private

    private func household(_ visit: Visit?) -> [UUID] {
        (visit?.participantIds ?? []).filter { householdIds.contains($0) }
    }

    private static func groupOrder(_ group: WhatToOrderGroup) -> Int {
        switch group {
        case .orderAgain: 0
        case .disagree: 1
        case .skip: 2
        case .unrated: 3
        }
    }

    private static func score(_ display: RatingDisplay<ItemRatingValue>) -> Int {
        switch display {
        case .joint(.loved): 3
        case .joint(.good): 2
        case .split: 1
        default: 0
        }
    }
}
