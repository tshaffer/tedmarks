import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

private func place(_ id: String, _ meters: Double) -> NearbyPlace {
    NearbyPlace(googlePlaceId: id, name: id, latitude: 37.39, longitude: -122.08, distanceMeters: meters)
}

@Test func savedPlacesRankAheadOfSlightlyCloserOnes() {
    let ranked = PlaceRanking.rank([place("cafe", 20), place("doppio", 60), place("far", 400)]) {
        $0.googlePlaceId == "doppio" ? .wantToGo : nil
    }
    #expect(ranked.map(\.googlePlaceId) == ["doppio", "cafe", "far"])
}

@Test func unsavedPlacesStayNearestFirst() {
    let ranked = PlaceRanking.rank([place("b", 50), place("a", 10)]) { _ in nil }
    #expect(ranked.map(\.googlePlaceId) == ["a", "b"])
}

@MainActor
@Test func startingVisitsCreatesPlaceOnceAndTracksFirstVisit() throws {
    let container = try ModelContainer(
        for: Person.self, Place.self, Visit.self,
        configurations: ModelConfiguration(isStoredInMemoryOnly: true)
    )
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let people = try context.fetch(FetchDescriptor<Person>())
    #expect(people.count == 2)

    let doppio = place("doppio", 30)
    let first = try VisitStarter.startVisit(at: doppio, participantIds: people.map(\.id), in: context)
    #expect(first.isFirstVisit)
    #expect(first.place?.status == .beenThere)

    let second = try VisitStarter.startVisit(at: doppio, participantIds: people.map(\.id), in: context)
    #expect(!second.isFirstVisit)
    #expect(first.status == .ended)
    #expect(try context.fetch(FetchDescriptor<Place>()).count == 1)
    #expect(try VisitStarter.activeVisits(in: context).map(\.id) == [second.id])
}

@Test func searchRadiusOptionsAndDefault() {
    #expect(NearbySearchSettings.options.map(\.label) == ["1 mile", "5 miles", "20 miles"])
    #expect(NearbySearchSettings.defaultRadiusMeters == 1609)
    let defaults = UserDefaults(suiteName: "radius-test")!
    defaults.removePersistentDomain(forName: "radius-test")
    #expect(NearbySearchSettings.radius(from: defaults) == 1609)
    defaults.set(32187, forKey: NearbySearchSettings.radiusKey)
    #expect(NearbySearchSettings.radius(from: defaults) == 32187)
    defaults.set(402, forKey: NearbySearchSettings.radiusKey)   // old/unknown value → default
    #expect(NearbySearchSettings.radius(from: defaults) == 1609)
}

@MainActor
@Test func whoIsHereCanChangeDuringTheVisit() throws {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let place = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 30)
    let visit = try VisitStarter.startVisit(at: place, participantIds: [Household.tedId, Household.loriId], in: context)

    // Lori wasn't there after all; Sam was (and "sam" is the same guest).
    let sam = try #require(try VisitStarter.guest(named: " Sam ", in: context))
    #expect(try VisitStarter.guest(named: "sam", in: context)?.id == sam.id)
    try VisitStarter.setParticipants([Household.tedId, sam.id, sam.id], for: visit, in: context)
    #expect(visit.participantIds == [Household.tedId, sam.id])
    #expect(sam.lastSeenAt != nil)
}
