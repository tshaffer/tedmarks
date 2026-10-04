import Foundation
import SwiftData

/// Creates (or reuses) the Place for a picked Google place and starts a Visit there.
/// Only one visit is in progress at a time; starting a new one ends the previous one.
public enum VisitStarter {
    @MainActor
    @discardableResult
    public static func startVisit(
        at picked: NearbyPlace,
        participantIds: [UUID],
        in context: ModelContext,
        now: Date = .now
    ) throws -> Visit {
        for active in try activeVisits(in: context) {
            active.status = .ended
            active.endedAt = now
            active.modifiedAt = now
        }

        let googleId = picked.googlePlaceId
        let existing = try context.fetch(
            FetchDescriptor<Place>(predicate: #Predicate { $0.googlePlaceId == googleId && $0.deletedAt == nil })
        ).first

        let place: Place
        if let existing {
            place = existing
        } else {
            place = Place(status: .beenThere, name: picked.name, latitude: picked.latitude, longitude: picked.longitude, now: now)
            context.insert(place)
        }
        place.googlePlaceId = picked.googlePlaceId
        place.googleAddress = picked.address ?? place.googleAddress
        place.googlePrimaryType = picked.primaryType ?? place.googlePrimaryType
        place.googlePrimaryTypeLabel = picked.primaryTypeLabel ?? place.googlePrimaryTypeLabel
        place.googleFetchedAt = now

        let isFirstVisit = !place.visits.contains { $0.deletedAt == nil }
        place.status = .beenThere
        place.modifiedAt = now

        let visit = Visit(place: place, startedAt: now, origin: .startVisit, participantIds: participantIds, isFirstVisit: isFirstVisit)
        context.insert(visit)

        let peopleIds = Set(participantIds)
        for person in try context.fetch(FetchDescriptor<Person>()) where peopleIds.contains(person.id) {
            person.lastSeenAt = now
        }

        try context.save()
        return visit
    }

    @MainActor
    public static func activeVisits(in context: ModelContext) throws -> [Visit] {
        let inProgress = VisitStatus.inProgress.rawValue
        return try context.fetch(
            FetchDescriptor<Visit>(predicate: #Predicate { $0.statusRaw == inProgress && $0.deletedAt == nil })
        )
    }

    @MainActor
    public static func endVisit(_ visit: Visit, in context: ModelContext, now: Date = .now) throws {
        visit.status = .ended
        visit.endedAt = now
        visit.modifiedAt = now
        try context.save()
    }

    /// Makes sure Ted and Lori exist as household people (first launch).
    @MainActor
    public static func ensureHousehold(in context: ModelContext) throws {
        let household = PersonKind.household.rawValue
        let existing = try context.fetch(FetchDescriptor<Person>(predicate: #Predicate { $0.kindRaw == household }))
        guard existing.isEmpty else { return }
        context.insert(Person(displayName: "Ted", kind: .household))
        context.insert(Person(displayName: "Lori", kind: .household))
        try context.save()
    }
}
