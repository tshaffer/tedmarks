import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@MainActor
@Test func confirmingADraftAppliesOnlyTheKeptChanges() throws {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 0)
    let us = [Household.tedId, Household.loriId]
    // An earlier visit, so "Funghi pizza" is a dish ordered before.
    let earlier = try VisitStarter.startVisit(at: doppio, participantIds: us, in: context, now: .now.addingTimeInterval(-86_400))
    try DishCapture.addItem(named: "Funghi pizza", to: earlier, addedVia: .order, in: context)
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: us, in: context)
    let burrata = try #require(try DishCapture.addItem(named: "Burrata", to: visit, addedVia: .order, in: context))
    let funghi = try #require(visit.place?.items.first { $0.name == "Funghi pizza" })

    let note = try VoiceDrafts.saveNote(transcript: "…", durationSec: 12, audioFileName: nil, visit: visit, in: context)
    let request = try VoiceDrafts.request(for: note, visit: visit, in: context)
    #expect(request.participants.first?.name == "Ted", "speaker first")
    #expect(request.dishes.map(\.name) == ["Burrata"])
    #expect(request.orderedBefore.map(\.name) == ["Funghi pizza"])

    let draft = try VoiceDrafts.makeDraft(from: [
        VoiceChange(kind: "itemRating", dishId: burrata.id.uuidString, dishName: "Burrata", value: "loved", evidence: "burrata was amazing"),
        VoiceChange(kind: "itemRating", dishId: funghi.id.uuidString, dishName: "Funghi pizza", personId: Household.loriId.uuidString, value: "skip"),
        VoiceChange(kind: "itemNote", dishId: funghi.id.uuidString, dishName: "Funghi pizza", text: "crust was soggy"),
        VoiceChange(kind: "itemRating", dishName: "Tiramisu", value: "good"),
        VoiceChange(kind: "verdict", value: "wouldReturn"),
        VoiceChange(kind: "visitNote", text: "Slow service"),
        VoiceChange(kind: "visitTag", text: "patio"),
    ], for: note, visit: visit, in: context)
    #expect(note.draftId == draft.id)
    #expect(draft.status == .pending)

    // Uncheck the service note.
    var changes = draft.changes
    changes[5].keep = false
    draft.changes = changes
    try VoiceDrafts.confirm(draft, in: context)

    #expect(draft.status == .confirmed)
    let order = DishCapture.orderItems(for: visit)
    #expect(order.map(\.displayName) == ["Burrata", "Funghi pizza", "Tiramisu"])
    #expect(try DishCapture.display(for: order[0], household: us, in: context) == .joint(.loved))
    #expect(try DishCapture.recordedValue(for: order[1].id, rateFor: .person(Household.loriId), in: context) == "skip")
    #expect(try DishCapture.ratings(for: order[0].id, in: context).first?.originRaw == "draft")
    #expect(try DishCapture.verdict(for: visit, household: us, in: context) == .joint(.wouldReturn))
    let notes = try context.fetch(FetchDescriptor<Note>())
    #expect(notes.map(\.text) == ["crust was soggy"])
    #expect(notes.first?.visitItemId == order[1].id)
    #expect(visit.tags == ["patio"])
}
