import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@MainActor
private func makeContext() throws -> (ModelContainer, ModelContext) {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    try VisitStarter.ensureHousehold(in: container.mainContext)
    return (container, container.mainContext)
}

@MainActor
private func visit(_ name: String, lat: Double, daysAgo: Double, in context: ModelContext) throws -> Visit {
    let picked = NearbyPlace(googlePlaceId: name, name: name, latitude: lat, longitude: -122.0, distanceMeters: 0)
    let visit = try VisitStarter.startVisit(at: picked, participantIds: [], in: context, now: Date(timeIntervalSinceNow: -daysAgo * 86_400))
    try VisitStarter.endVisit(visit, in: context)
    return visit
}

@MainActor
@Test func sortsPastVisitsByRecentNameAndDistance() throws {
    let (container, context) = try makeContext()
    _ = container
    let far = try visit("Zola", lat: 37.50, daysAgo: 1, in: context)
    let near = try visit("bistro", lat: 37.40, daysAgo: 3, in: context)
    let middle = try visit("Anchor", lat: 37.45, daysAgo: 2, in: context)
    let all = [near, far, middle]

    #expect(PastVisits.sorted(all, by: .recent).map(\.id) == [far, middle, near].map(\.id))
    #expect(PastVisits.sorted(all, by: .name).map(\.id) == [middle, near, far].map(\.id))
    #expect(PastVisits.sorted(all, by: .distance, from: (37.39, -122.0)).map(\.id) == [near, middle, far].map(\.id))
    // No location yet: distance falls back to most recent.
    #expect(PastVisits.sorted(all, by: .distance).map(\.id) == [far, middle, near].map(\.id))
}

@MainActor
@Test func deletingAVisitRemovesItsDishesAndRatings() throws {
    let (container, context) = try makeContext()
    _ = container
    let doomed = try visit("Doppio Zero", lat: 37.39, daysAgo: 1, in: context)
    let dish = try #require(try DishCapture.addItem(named: "Burrata", to: doomed, addedVia: .order, in: context))
    try DishCapture.rate(dish, .loved, for: .us, enteredBy: nil, in: context)
    try DishCapture.setVerdict(doomed, .wouldReturn, for: .us, enteredBy: nil, in: context)

    try PastVisits.delete(doomed, in: context)

    #expect(doomed.deletedAt != nil)
    #expect(DishCapture.orderItems(for: doomed).isEmpty)
    #expect(try DishCapture.ratings(for: dish.id, in: context).isEmpty)
    #expect(try DishCapture.ratings(for: doomed.id, in: context).isEmpty)
    // The place keeps its dish names for "Ordered before" on later visits.
    #expect(doomed.place?.items.count == 1)
}

@MainActor
@Test func deletingAPlaceDeletesItsVisitsDishesAndRatings() throws {
    let (container, context) = try makeContext()
    _ = container
    let past = try visit("Doppio Zero", lat: 37.39, daysAgo: 3, in: context)
    let dish = try #require(try DishCapture.addItem(named: "Burrata", to: past, addedVia: .order, in: context))
    try DishCapture.rate(dish, .loved, for: .us, enteredBy: nil, in: context)
    let place = try #require(past.place)
    let current = try VisitStarter.startVisit(at: place, participantIds: [], in: context)
    let elsewhere = try visit("Tamarine", lat: 37.44, daysAgo: 1, in: context)

    try PlaceEditing.delete(place, in: context)

    #expect(place.deletedAt != nil)
    #expect(past.deletedAt != nil && current.deletedAt != nil)
    #expect(current.status == .ended)
    #expect(place.items.allSatisfy { $0.deletedAt != nil })
    #expect(try DishCapture.ratings(for: dish.id, in: context).isEmpty)
    #expect(elsewhere.deletedAt == nil)
    #expect(try VisitStarter.activeVisits(in: context).isEmpty)
}
