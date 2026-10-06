import Foundation
import SwiftData

/// How the Past visits list is ordered.
public enum PastVisitSort: String, CaseIterable, Sendable {
    case recent, name, distance

    public var label: String {
        switch self {
        case .recent: "Most recent"
        case .name: "Name"
        case .distance: "Nearest"
        }
    }
}

/// The Past visits screen: ordering and deleting visits.
@MainActor
public enum PastVisits {

    /// Orders visits for the list. Name and distance ties fall back to most recent first;
    /// distance needs `from` (latitude, longitude) and otherwise sorts by most recent.
    public static func sorted(_ visits: [Visit], by sort: PastVisitSort, from origin: (latitude: Double, longitude: Double)? = nil) -> [Visit] {
        let recent = visits.sorted { $0.startedAt > $1.startedAt }
        switch sort {
        case .recent:
            return recent
        case .name:
            return recent.enumerated().sorted { a, b in
                let order = (a.element.place?.name ?? "").localizedStandardCompare(b.element.place?.name ?? "")
                return order == .orderedSame ? a.offset < b.offset : order == .orderedAscending
            }.map(\.element)
        case .distance:
            guard let origin else { return recent }
            let meters = Dictionary(uniqueKeysWithValues: recent.map { ($0.id, distanceMeters(to: $0, from: origin) ?? .infinity) })
            return recent.enumerated().sorted { a, b in
                let da = meters[a.element.id] ?? .infinity, db = meters[b.element.id] ?? .infinity
                return da == db ? a.offset < b.offset : da < db
            }.map(\.element)
        }
    }

    /// Straight-line distance from `origin` to the visit's place, or nil if it has no place.
    public static func distanceMeters(to visit: Visit, from origin: (latitude: Double, longitude: Double)) -> Double? {
        guard let place = visit.place else { return nil }
        let radians = { (degrees: Double) in degrees * .pi / 180 }
        let dLat = radians(place.latitude - origin.latitude)
        let dLon = radians(place.longitude - origin.longitude)
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(radians(origin.latitude)) * cos(radians(place.latitude)) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000 * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /// Deletes a visit (tombstoned, like everything else) along with its dishes and ratings.
    /// The place and its dish names stay.
    public static func delete(_ visit: Visit, in context: ModelContext, now: Date = .now) throws {
        for rating in try DishCapture.ratings(for: visit.id, in: context) {
            rating.deletedAt = now
            rating.modifiedAt = now
        }
        for item in visit.items where item.deletedAt == nil {
            for rating in try DishCapture.ratings(for: item.id, in: context) {
                rating.deletedAt = now
                rating.modifiedAt = now
            }
            item.deletedAt = now
            item.modifiedAt = now
        }
        if visit.status == .inProgress {
            visit.status = .ended
            visit.endedAt = now
        }
        visit.deletedAt = now
        visit.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }
}

/// Saving, editing and deleting places.
@MainActor
public enum PlaceEditing {
    /// "Want to go": saves a Google place to try, or updates its interest if it's already saved
    /// (a place we've been to stays "been there"; a deleted one comes back).
    @discardableResult
    public static func saveToTry(
        _ picked: NearbyPlace, level: InterestLevel, why: String?, in context: ModelContext, now: Date = .now
    ) throws -> Place {
        let googleId = picked.googlePlaceId
        let place: Place
        if let existing = try context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.googlePlaceId == googleId })).first {
            place = existing
            if place.deletedAt != nil {
                place.deletedAt = nil
                place.status = .wantToGo
            }
        } else {
            place = Place(status: .wantToGo, name: picked.name, latitude: picked.latitude, longitude: picked.longitude, now: now)
            place.googlePlaceId = googleId
            place.googleAddress = picked.address
            place.googlePrimaryType = picked.primaryType
            place.googlePrimaryTypeLabel = picked.primaryTypeLabel
            place.googleFetchedAt = now
            context.insert(place)
        }
        place.interestLevel = level
        place.interestWhy = why?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        place.interestSavedAt = place.interestSavedAt ?? now
        place.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
        return place
    }

    /// The Edit place screen's fields.
    public struct Changes: Sendable {
        public var name: String
        public var status: PlaceStatus
        public var subtypeId: UUID?
        public var review: String
        public var interestLevel: InterestLevel?
        public var interestWhy: String

        public init(_ place: Place) {
            name = place.name
            status = place.status
            subtypeId = place.subtypeId
            review = place.review ?? ""
            interestLevel = place.interestLevel
            interestWhy = place.interestWhy ?? ""
        }
    }

    public static func update(_ place: Place, with changes: Changes, in context: ModelContext, now: Date = .now) throws {
        let name = changes.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { place.name = name }
        place.status = changes.status
        place.subtypeId = changes.subtypeId
        place.review = changes.review.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        place.interestLevel = changes.interestLevel
        place.interestWhy = changes.interestLevel == nil ? nil : changes.interestWhy.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        if changes.interestLevel != nil { place.interestSavedAt = place.interestSavedAt ?? now }
        place.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    /// Deletes a place (tombstoned) with every visit to it — their dishes and ratings too — and
    /// its dish list. Notes stay on the server, hidden with their place (the phone doesn't send notes).
    public static func delete(_ place: Place, in context: ModelContext, now: Date = .now) throws {
        for visit in place.visits where visit.deletedAt == nil {
            try PastVisits.delete(visit, in: context, now: now)
        }
        for item in place.items where item.deletedAt == nil {
            item.deletedAt = now
            item.modifiedAt = now
        }
        place.deletedAt = now
        place.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
