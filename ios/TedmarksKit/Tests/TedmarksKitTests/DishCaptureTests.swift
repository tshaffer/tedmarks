import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@MainActor
private struct Fixture {
    let container: ModelContainer
    let context: ModelContext
    let ted: Person
    let lori: Person
    let visit: Visit

    init() throws {
        container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = container.mainContext
        try VisitStarter.ensureHousehold(in: context)
        let people = try context.fetch(FetchDescriptor<Person>())
        ted = people.first { $0.displayName == "Ted" }!
        lori = people.first { $0.displayName == "Lori" }!
        let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 30)
        visit = try VisitStarter.startVisit(at: doppio, participantIds: [ted.id, lori.id], in: context)
    }

    var household: [UUID] { DishCapture.household(for: visit, people: [ted, lori]) }
}

@MainActor
@Test func addingTheSameDishTwiceReusesIt() throws {
    let f = try Fixture()
    let a = try DishCapture.addItem(named: "Burrata", to: f.visit, addedVia: .rating, in: f.context)
    let b = try DishCapture.addItem(named: "  burrata ", to: f.visit, addedVia: .rating, in: f.context)
    #expect(a?.id == b?.id)
    #expect(DishCapture.orderItems(for: f.visit).count == 1)
    #expect(f.visit.place?.items.count == 1)
}

@MainActor
@Test func jointThenDifferingPersonRatingSplits() throws {
    let f = try Fixture()
    let arancini = try #require(try DishCapture.addItem(named: "Arancini", to: f.visit, addedVia: .rating, in: f.context))
    try DishCapture.rate(arancini, .loved, for: .us, enteredBy: f.ted.id, in: f.context)
    #expect(try DishCapture.display(for: arancini, household: f.household, in: f.context) == .joint(.loved))

    try DishCapture.rate(arancini, .skip, for: .person(f.ted.id), enteredBy: f.ted.id, in: f.context)
    let display = try DishCapture.display(for: arancini, household: f.household, in: f.context)
    #expect(display == .split([
        .init(personId: f.ted.id.uuidString, value: .skip),
        .init(personId: f.lori.id.uuidString, value: .loved),
    ]))

    // Re-rating the same scope updates rather than duplicates.
    try DishCapture.rate(arancini, .loved, for: .person(f.ted.id), enteredBy: f.ted.id, in: f.context)
    #expect(try DishCapture.ratings(for: arancini.id, in: f.context).count == 2)
    #expect(try DishCapture.display(for: arancini, household: f.household, in: f.context) == .joint(.loved))
}

@MainActor
@Test func verdictAndUnnamedDishes() throws {
    let f = try Fixture()
    let dish = try DishCapture.addUnnamedItem(to: f.visit, in: f.context)
    #expect(dish.displayName == "Dish 1")
    try DishCapture.setVerdict(f.visit, .wouldReturn, for: .us, enteredBy: f.ted.id, in: f.context)
    #expect(try DishCapture.verdict(for: f.visit, household: f.household, in: f.context) == .joint(.wouldReturn))
    #expect(try DishCapture.recordedValue(for: f.visit.id, rateFor: .us, in: f.context) == "wouldReturn")
    #expect(try DishCapture.recordedValue(for: f.visit.id, rateFor: .person(f.lori.id), in: f.context) == nil)
}

@MainActor
@Test func orderedBeforeListsEarlierDishesNotYetOrdered() throws {
    let f = try Fixture()
    try DishCapture.addItem(named: "Burrata", to: f.visit, addedVia: .rating, in: f.context)
    try DishCapture.addItem(named: "Funghi pizza", to: f.visit, addedVia: .rating, in: f.context)
    let place = try #require(f.visit.place)
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 30)
    let second = try VisitStarter.startVisit(at: doppio, participantIds: [f.ted.id, f.lori.id], in: f.context, now: .now.addingTimeInterval(86_400))
    #expect(Set(DishCapture.orderedBefore(at: place, excluding: second).map(\.name)) == ["Burrata", "Funghi pizza"])

    let burrata = try #require(place.items.first { $0.name == "Burrata" })
    try DishCapture.addItem(burrata, to: second, addedVia: .order, in: f.context)
    #expect(DishCapture.orderedBefore(at: place, excluding: second).map(\.name) == ["Funghi pizza"])
}

@Test func normalizesNamesLikeTypeScript() {
    #expect(normalizeItemName("  Doppio   Zero PIZZA ") == "doppio zero pizza")
}

@MainActor
@Test func addOneCountsUpAndRemoveOneCountsDown() throws {
    let f = try Fixture()
    let line = try #require(try DishCapture.addOne(named: "Arancini", to: f.visit, addedVia: .order, in: f.context))
    #expect(line.count == 1 && line.quantity == nil && line.orderLabel == "Arancini")
    try DishCapture.addOne(named: "arancini", to: f.visit, addedVia: .order, in: f.context)
    #expect(line.count == 2 && line.orderLabel == "Arancini ×2")
    #expect(DishCapture.orderItems(for: f.visit).count == 1)

    try DishCapture.removeOne(line, in: f.context)
    #expect(line.count == 1 && line.deletedAt == nil)
    try DishCapture.removeOne(line, in: f.context)
    #expect(line.deletedAt != nil)
    #expect(DishCapture.orderItems(for: f.visit).isEmpty)
}
