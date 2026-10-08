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

private let us = [Household.tedId, Household.loriId]

@MainActor
@Test func placePageGroupsDishesAndUsesTheLatestVerdict() throws {
    let (container, context) = try makeContext()
    _ = container
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", address: "160 Castro St, Mountain View, CA 94041, USA",
                             latitude: 37.39, longitude: -122.08, distanceMeters: 0)
    let first = try VisitStarter.startVisit(at: doppio, participantIds: us, in: context, now: .now.addingTimeInterval(-86_400 * 30))
    let burrata = try #require(try DishCapture.addItem(named: "Burrata", to: first, addedVia: .order, in: context))
    let tiramisu = try #require(try DishCapture.addItem(named: "Tiramisu", to: first, addedVia: .order, in: context))
    let pizza = try #require(try DishCapture.addItem(named: "Pizza", to: first, addedVia: .order, in: context))
    try DishCapture.rate(burrata, .loved, for: .us, enteredBy: nil, in: context)
    try DishCapture.rate(tiramisu, .skip, for: .us, enteredBy: nil, in: context)
    try DishCapture.rate(pizza, .good, for: .person(Household.tedId), enteredBy: nil, in: context)
    try DishCapture.rate(pizza, .skip, for: .person(Household.loriId), enteredBy: nil, in: context)
    try DishCapture.setVerdict(first, .wouldReturn, for: .us, enteredBy: nil, in: context)
    try VisitStarter.endVisit(first, in: context)
    // A later visit with no verdict yet: the list keeps showing the last verdict we gave.
    let second = try VisitStarter.startVisit(at: doppio, participantIds: us, in: context)
    try DishCapture.addItem(named: "burrata", to: second, addedVia: .order, in: context)
    let note = Note(placeId: try #require(first.place).id, text: "Get extra bread")
    note.visitItemId = burrata.id
    context.insert(note)
    try context.save()

    let place = try #require(first.place)
    let insights = try PlaceInsights(context: context)
    let summary = insights.summary(for: place)
    #expect(summary.visitCount == 2)
    #expect(summary.verdict == .joint(.wouldReturn))

    let dishes = insights.dishes(at: place)
    #expect(dishes.map(\.item.name) == ["Burrata", "Pizza", "Tiramisu"])
    #expect(dishes.map(\.group) == [.orderAgain, .disagree, .skip])
    #expect(dishes[0].timesOrdered == 2)
    #expect(dishes[0].latest == .joint(.loved))
    #expect(dishes[0].comments == ["Get extra bread"])
    #expect(PlaceInsights.city(of: place) == "Mountain View")
}

@MainActor
@Test func placesListFiltersSearchesAndSorts() throws {
    let (container, context) = try makeContext()
    _ = container
    func save(_ name: String, _ status: PlaceStatus, lat: Double) -> Place {
        let place = Place(status: status, name: name, latitude: lat, longitude: -122.0)
        context.insert(place)
        return place
    }
    let far = save("Zola", .beenThere, lat: 37.6)
    let near = save("Anchor", .beenThere, lat: 37.4)
    let wish = save("Bruno's", .wantToGo, lat: 37.41)
    try context.save()
    let insights = try PlaceInsights(context: context)
    let all = [far, near, wish]

    let been = insights.summaries(of: all, filter: .beenThere, search: "", sort: .name, from: nil)
    #expect(been.map(\.place.name) == ["Anchor", "Zola"])
    let nearest = insights.summaries(of: all, filter: .all, search: "", sort: .nearest, from: (37.39, -122.0))
    #expect(nearest.map(\.place.name) == ["Anchor", "Bruno's", "Zola"])
    #expect(insights.summaries(of: all, filter: .all, search: "brun", sort: .name, from: nil).map(\.place.name) == ["Bruno's"])
}

@MainActor
@Test func tagsAreSavedCleanAndSearchable() throws {
    let (container, context) = try makeContext()
    _ = container
    let place = Place(status: .beenThere, name: "Doppio Zero", latitude: 37.39, longitude: -122.08)
    context.insert(place)
    try context.save()

    var changes = PlaceEditing.Changes(place)
    changes.tags = [" patio ", "date night", "patio", ""]
    try PlaceEditing.update(place, with: changes, in: context)
    #expect(place.tags == ["patio", "date night"])

    let insights = try PlaceInsights(context: context)
    #expect(insights.summaries(of: [place], filter: .all, search: "date", sort: .name, from: nil).map(\.place.name) == ["Doppio Zero"])
    #expect(insights.summaries(of: [place], filter: .all, search: "brunch", sort: .name, from: nil).isEmpty)
}
