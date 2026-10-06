import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@MainActor
@Test func readingAMenuUpdatesThePlacesDishesAndGroupsThemBySection() throws {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 0)
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: [Household.tedId], in: context)
    let place = try #require(visit.place)
    // Ordered before; one is still on the menu, one isn't.
    try DishCapture.addItem(named: "burrata", to: visit, addedVia: .order, in: context)
    try DishCapture.addItem(named: "Seasonal risotto", to: visit, addedVia: .order, in: context)

    let page = Photo(placeId: place.id, role: .menuPage, localIdentifier: "asset-1", cloudIdentifier: nil, capturedAt: .now, capturedBy: Household.tedId)
    context.insert(page)
    let menu = try MenuReading.startMenu(place: place, visit: visit, pages: [page], in: context)
    #expect(menu.readStatus == .pending)
    #expect(page.menuId == menu.id)

    try MenuReading.apply([
        MenuItem(section: "Antipasti", name: "Burrata", price: "16"),
        MenuItem(section: "Antipasti", name: "Arancini", price: "12"),
        MenuItem(section: "Pizza", name: "Margherita", price: "18"),
    ], to: menu, in: context)

    #expect(menu.readStatus == .read)
    #expect(place.latestMenuId == menu.id)
    let items = Dictionary(uniqueKeysWithValues: place.items.map { ($0.name, $0) })
    #expect(items.count == 4, "burrata matched by name, two new dishes, risotto kept")
    #expect(items["burrata"]?.price == "16")
    #expect(items["burrata"]?.sources == ["order", "menu"])
    #expect(items["Margherita"]?.section == "Pizza")
    #expect(items["Seasonal risotto"]?.onLatestMenu == false)

    let sections = try MenuReading.sections(for: place, in: context)
    #expect(sections.map(\.title) == ["Antipasti", "Pizza"])
    #expect(sections[0].items.map(\.name) == ["burrata", "Arancini"])
}
