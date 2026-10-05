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
