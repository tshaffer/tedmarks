import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

@MainActor
@Test func visitNotesCanBeAddedEditedAndDeleted() throws {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    try VisitStarter.ensureHousehold(in: context)
    let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", latitude: 37.39, longitude: -122.08, distanceMeters: 0)
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: [], in: context)
    let dish = try #require(try DishCapture.addItem(named: "Burrata", to: visit, addedVia: .order, in: context))
    let dishNote = Note(placeId: try #require(visit.place).id, text: "extra bread")
    dishNote.visitId = visit.id
    dishNote.visitItemId = dish.id
    context.insert(dishNote)

    #expect(try NoteEditing.addVisitNote("   ", to: visit, in: context) == nil)
    let note = try #require(try NoteEditing.addVisitNote(" Slow service but worth it ", to: visit, in: context))
    try NoteEditing.addVisitNote("Sat on the patio", to: visit, in: context, now: .now.addingTimeInterval(1))
    #expect(try NoteEditing.visitNotes(for: visit, in: context).map(\.text) == ["Slow service but worth it", "Sat on the patio"])

    try NoteEditing.update(note, text: "Slow service, worth the wait", in: context)
    #expect(note.text == "Slow service, worth the wait")
    try NoteEditing.update(note, text: "", in: context)
    #expect(try NoteEditing.visitNotes(for: visit, in: context).map(\.text) == ["Sat on the patio"])
}
