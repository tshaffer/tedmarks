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
        let googleId = picked.googlePlaceId
        // Prefer a live record; a deleted one comes back rather than making a second record.
        let matches = try context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.googlePlaceId == googleId }))
        let existing = matches.first { $0.deletedAt == nil } ?? matches.max { $0.modifiedAt < $1.modifiedAt }

        let place: Place
        if let existing {
            place = existing
            place.deletedAt = nil
        } else {
            place = Place(status: .beenThere, name: picked.name, latitude: picked.latitude, longitude: picked.longitude, now: now)
            context.insert(place)
        }
        place.googlePlaceId = picked.googlePlaceId
        place.googleAddress = picked.address ?? place.googleAddress
        place.googlePrimaryType = picked.primaryType ?? place.googlePrimaryType
        place.googlePrimaryTypeLabel = picked.primaryTypeLabel ?? place.googlePrimaryTypeLabel
        place.googleFetchedAt = now
        return try startVisit(at: place, participantIds: participantIds, in: context, now: now)
    }

    /// Starts a visit at a place already saved (e.g. "Start a visit here" on its Place page).
    @MainActor
    @discardableResult
    public static func startVisit(
        at place: Place,
        participantIds: [UUID],
        in context: ModelContext,
        now: Date = .now
    ) throws -> Visit {
        for active in try activeVisits(in: context) {
            active.status = .ended
            active.endedAt = now
            active.modifiedAt = now
        }

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
        VisitSideEffects.reconcile(in: context)
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
        VisitSideEffects.reconcile(in: context)
    }

    /// Makes sure Ted and Lori exist as household people, with the same ids on every install
    /// (so a reinstall, a second phone and the server all agree on who they are).
    /// Earlier builds gave them random ids; those are moved to the fixed ones, with every reference.
    @MainActor
    public static func ensureHousehold(in context: ModelContext) throws {
        let household = PersonKind.household.rawValue
        var people = try context.fetch(FetchDescriptor<Person>(predicate: #Predicate { $0.kindRaw == household }))
        for (name, fixedId) in [("Ted", Household.tedId), ("Lori", Household.loriId)] {
            let fixed = people.first { $0.id == fixedId }
            if let old = people.first(where: { $0.displayName == name && $0.id != fixedId && $0.deletedAt == nil }) {
                try remapPerson(from: old.id, to: fixedId, in: context)
                if fixed == nil {
                    old.id = fixedId
                } else {
                    context.delete(old)   // created before sync existed, so never on the server
                    people.removeAll { $0 === old }
                }
            } else if fixed == nil {
                let person = Person(id: fixedId, displayName: name, kind: .household)
                context.insert(person)
                people.append(person)
            }
        }
        if context.hasChanges { try context.save() }
    }

    @MainActor
    private static func remapPerson(from old: UUID, to new: UUID, in context: ModelContext) throws {
        for visit in try context.fetch(FetchDescriptor<Visit>()) where visit.participantIds.contains(old) {
            visit.participantIds = visit.participantIds.map { $0 == old ? new : $0 }
        }
        for rating in try context.fetch(FetchDescriptor<Rating>()) {
            if rating.personId == old { rating.personId = new }
            if rating.enteredByPersonId == old { rating.enteredByPersonId = new }
        }
    }

    /// The person who owns this phone (Ted, for now — sign-in will make this explicit).
    @MainActor
    public static func devicePerson(in context: ModelContext) throws -> Person? {
        let household = PersonKind.household.rawValue
        let people = try context.fetch(FetchDescriptor<Person>(predicate: #Predicate { $0.kindRaw == household }))
        return people.first { $0.id == Household.tedId } ?? people.min { $0.createdAt < $1.createdAt }
    }
}

/// Ted and Lori's fixed person ids (the same on every install and on the server).
public enum Household {
    public static let tedId = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
    public static let loriId = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
}
