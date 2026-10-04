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

@Test func nearbyRangeHandlesDontWidenAndSmallMax() {
    #expect(NearbySearchSettings.range(startMeters: 402, maxMeters: 0) == (402, 402))
    #expect(NearbySearchSettings.range(startMeters: 1609, maxMeters: 805) == (1609, 1609))
    #expect(NearbySearchSettings.range(startMeters: 402, maxMeters: 8047) == (402, 8047))
}

@Test func defaultsAreAmongTheOptions() {
    #expect(NearbySearchSettings.startOptions.contains { $0.meters == NearbySearchSettings.defaultStartMeters })
    #expect(NearbySearchSettings.maxOptions.contains { $0?.meters == NearbySearchSettings.defaultMaxMeters })
}
