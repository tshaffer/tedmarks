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

private func saved(_ name: String, googleId: String?, status: PlaceStatus = .wantToGo, latitude: Double = 33.49, longitude: Double = -111.92) -> Place {
    let place = Place(status: status, name: name, latitude: latitude, longitude: longitude)
    place.googlePlaceId = googleId
    return place
}

@MainActor
@Test func theMapHasEverySavedPlaceWithoutRepeats() {
    let both = saved("Doppio", googleId: "doppio")
    let farAway = saved("FnB", googleId: "fnb")
    let noGoogleId = saved("Old favorite", googleId: nil)
    let nowhere = saved("Nowhere", googleId: "nowhere", latitude: 0, longitude: 0)
    let items = MapPlaces.merged(found: [place("doppio", 30), place("cafe", 50), place("cafe", 50)], saved: [both, farAway, noGoogleId, nowhere], from: (37.39, -122.08))
    #expect(items.map(\.place.googlePlaceId) == ["doppio", "cafe", "fnb", noGoogleId.id.uuidString])
    #expect(items[0].saved === both)
    #expect(items[1].saved == nil)
    #expect(items[2].place.name == "FnB")
    #expect(items[2].place.distanceMeters > 900_000)
}

@MainActor
@Test func startVisitOnlyReachesNearbyPlaces() {
    let home = (latitude: 37.39, longitude: -122.08)
    #expect(MapPlaces.isWithinReach(place("doppio", 30), of: home))
    let scottsdale = NearbyPlace(googlePlaceId: "fnb", name: "FnB", latitude: 33.49, longitude: -111.92, distanceMeters: 0)
    #expect(!MapPlaces.isWithinReach(scottsdale, of: home))
}

@Test func mapBoundsContainWhatsInView() {
    let bounds = MapBounds(south: 33, west: -112, north: 34, east: -111)
    #expect(bounds.contains(latitude: 33.5, longitude: -111.9))
    #expect(!bounds.contains(latitude: 37.4, longitude: -122.1))
}
