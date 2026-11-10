import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@Test func comparingAReadingWithTheMenuFindsNewChangedAndSameDishes() {
    let existing = [MenuItem(section: "Pizza", name: "Margherita", price: "18"), MenuItem(section: "Pizza", name: "Diavola", price: "20")]
    let read = [MenuItem(section: "Pizza", name: "margherita", price: "19"), MenuItem(section: "Pizza", name: "Diavola", price: " 20"),
                MenuItem(section: "Dolci", name: "Tiramisu", price: "10")]
    let compared = MenuDishes.compare(existing: existing, read: read)
    #expect(compared.map(\.status) == [.changed, .same, .new])
    #expect(compared[0].previousPrice == "18")
}

@Test func mergingPutsNewDishesAfterTheirSection() {
    let existing = [MenuItem(section: "Antipasti", name: "Burrata", price: "16"), MenuItem(section: "Pizza", name: "Margherita", price: "18")]
    let merged = MenuDishes.merge(existing: existing, checked: [
        MenuItem(section: "Antipasti", name: "Arancini", price: "12"),
        MenuItem(section: "Dolci", name: "Tiramisu", price: "10"),
        MenuItem(section: "Pizza", name: "margherita", price: "19", description: "Tomato, basil"),
    ])
    #expect(merged.map(\.name) == ["Burrata", "Arancini", "Margherita", "Tiramisu"])
    #expect(merged[2].price == "19" && merged[2].description == "Tomato, basil")
}

@MainActor
private func placeWithMenu() throws -> (ModelContainer, ModelContext, Place, PlaceMenu) {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 0)
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: [Household.tedId], in: context)
    let place = try #require(visit.place)
    try DishCapture.addItem(named: "Burrata", to: visit, addedVia: .order, in: context)
    let menu = try MenuReading.startMenu(place: place, visit: nil, pages: [], in: context)
    menu.pages = [MenuPageRef(mediaType: "image/jpeg")]
    try MenuReading.apply([MenuItem(section: "Antipasti", name: "Burrata", price: "16"), MenuItem(section: "Pizza", name: "Margherita", price: "18")],
                          to: menu, in: context)
    return (container, context, place, menu)
}

@MainActor
@Test func addedPagesJoinTheMenuWithoutMarkingDishesOff() throws {
    let (container, context, place, menu) = try placeWithMenu()
    _ = container
    let page = MenuPageRef(mediaType: "application/pdf")
    menu.pages.append(page)
    try MenuReading.applyAdded([MenuItem(section: "Dolci", name: "Tiramisu", price: "10"), MenuItem(section: "Pizza", name: "Margherita", price: "19")],
                               pageIds: [page.id], to: menu, in: context)
    #expect(menu.extracted?.map(\.name) == ["Burrata", "Margherita", "Tiramisu"])
    #expect(menu.review?.items.map(\.status) == [.new, .changed])
    #expect(menu.review?.pageIds == [page.id])
    let items = Dictionary(uniqueKeysWithValues: place.items.map { ($0.name, $0) })
    #expect(items["Burrata"]?.onLatestMenu == true, "not on the new pages, still on the menu")
    #expect(items["Margherita"]?.price == "19")
    #expect(items["Tiramisu"]?.sources == ["menu"])
}

@MainActor
@Test func finishingAReviewUndoesWhatWasRemovedAndKeepsEdits() throws {
    let (container, context, place, menu) = try placeWithMenu()
    _ = container
    try MenuReading.applyAdded([MenuItem(section: "Dolci", name: "Tiramisu", price: "10"), MenuItem(section: "Pizza", name: "Margherita", price: "19"),
                                MenuItem(section: "Dolci", name: "Panna cota", price: "9")],
                               pageIds: [], to: menu, in: context)
    let review = try #require(menu.review)
    try MenuReading.finishReview(menu, edits: [
        MenuReviewEdit(original: review.items[0], edited: nil),   // not really on the menu
        MenuReviewEdit(original: review.items[1], edited: nil),   // the price didn't change
        MenuReviewEdit(original: review.items[2], edited: MenuItem(section: "Dolci", name: "Panna cotta", price: "9")),
        MenuReviewEdit(original: nil, edited: MenuItem(section: "Dolci", name: "Affogato", price: "8")),
    ], in: context)
    #expect(menu.review == nil)
    #expect(menu.extracted?.map(\.name) == ["Burrata", "Margherita", "Panna cotta", "Affogato"])
    #expect(menu.extracted?[1].price == "18")
    let live = place.items.filter { $0.deletedAt == nil }
    #expect(live.first { $0.name == "Tiramisu" }?.onLatestMenu == false)
    #expect(live.contains { $0.name == "Panna cotta" } && !live.contains { $0.name == "Panna cota" })
}

@MainActor
@Test func editingADishRenamesItAndRefusesClashes() throws {
    let (container, context, place, menu) = try placeWithMenu()
    _ = container
    try MenuReading.editDish(in: menu, at: 0, to: MenuItem(section: "Antipasti", name: "Burrata pugliese", price: "17", description: "With tomatoes"), in: context)
    let burrata = try #require(place.items.first { $0.normalizedName == normalizeItemName("Burrata pugliese") })
    #expect(burrata.price == "17" && burrata.sources.contains("order"), "the dish we ordered, renamed")
    #expect(menu.extracted?[0].description == "With tomatoes")
    #expect(throws: MenuDishError.alreadyOnMenu("Margherita")) {
        try MenuReading.editDish(in: menu, at: 0, to: MenuItem(section: nil, name: "margherita", price: nil), in: context)
    }
    #expect(throws: MenuDishError.emptyName) {
        try MenuReading.editDish(in: menu, at: 2, to: MenuItem(section: nil, name: "  ", price: nil), in: context)
    }
    try MenuReading.editDish(in: menu, at: 1, to: nil, in: context)
    #expect(menu.extracted?.map(\.name) == ["Burrata pugliese"])
    #expect(place.items.first { $0.name == "Margherita" }?.onLatestMenu == false)
}

private actor FakePages: MenuPageTransport {
    var stored: [UUID: Data] = [:]
    var deleted: [UUID] = []
    var offline = false
    func setOffline(_ value: Bool) { offline = value }
    func uploadMenuPage(id: UUID, data: Data, mediaType: String) async throws {
        if offline { throw TedmarksAPIError.unreachable }
        stored[id] = data
    }
    func downloadMenuPage(id: UUID) async throws -> Data {
        guard let data = stored[id] else { throw TedmarksAPIError.server(status: 404, message: nil) }
        return data
    }
    func deleteMenuPage(id: UUID) async throws {
        if offline { throw TedmarksAPIError.unreachable }
        deleted.append(id)
    }
}

@MainActor
@Test func pagesWaitToBeSentAndAreKeptOnceFetched() async throws {
    let folder = URL.temporaryDirectory.appending(path: UUID().uuidString)
    let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
    let cache = MenuPageCache(folder: folder, defaults: defaults)
    let server = FakePages()
    let taken = UUID()
    try cache.add(Data("page".utf8), id: taken, mediaType: "image/png")
    await server.setOffline(true)
    await cache.flush(using: server)
    #expect(cache.waitingToSend == 1)
    await server.setOffline(false)
    await cache.flush(using: server)
    #expect(cache.waitingToSend == 0)
    #expect(await server.stored[taken] == Data("page".utf8))

    cache.remove([taken])
    #expect(!cache.isCached(taken))
    let fresh = MenuPageCache(folder: folder, defaults: defaults)
    #expect(try await fresh.data(for: taken, using: server) == Data("page".utf8), "fetched again from the server")
    #expect(fresh.isCached(taken))
    await fresh.flush(using: server)
    #expect(await server.deleted == [taken])
}
