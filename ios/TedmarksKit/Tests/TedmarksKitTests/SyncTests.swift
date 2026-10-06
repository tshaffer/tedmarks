import Foundation
import SwiftData
import Testing
@testable import TedmarksKit

/// A tiny stand-in for the API's sync endpoints: latest modifiedAt wins, omitted fields are
/// kept, null clears (same rules as api/src/sync/syncLogic.ts).
private actor FakeServer: SyncTransport {
    private var records: [String: [String: SyncRecord]] = [:]
    private var seq = 0
    private(set) var pushedCount = 0

    func syncPush(_ changes: [String: [SyncRecord]]) async throws -> SyncPushResult {
        var result = SyncPushResult()
        for (collection, patches) in changes {
            for patch in patches {
                guard let id = patch["id"]?.string else { continue }
                pushedCount += 1
                let existing = records[collection]?[id]
                if let existing,
                   let theirs = SyncValue.parseDate(existing["modifiedAt"]),
                   let mine = SyncValue.parseDate(patch["modifiedAt"]),
                   theirs > mine {
                    result.newer[collection, default: []].append(existing)
                    continue
                }
                var merged = existing ?? [:]
                for (key, value) in patch { merged[key] = value == .null ? nil : value }
                seq += 1
                merged["serverSeq"] = .number(Double(seq))
                records[collection, default: [:]][id] = merged
                result.accepted.append(.init(collection: collection, id: id, serverSeq: seq))
            }
        }
        return result
    }

    func syncPull(since: Int, limit: Int) async throws -> SyncPullResult {
        func seqOf(_ record: SyncRecord) -> Int { Int(record["serverSeq"]?.number ?? 0) }
        var all: [(collection: String, record: SyncRecord)] = []
        for (collection, byId) in records {
            for record in byId.values where seqOf(record) > since { all.append((collection, record)) }
        }
        all.sort { seqOf($0.record) < seqOf($1.record) }
        let page = all.prefix(limit)
        var changes: [String: [SyncRecord]] = [:]
        for entry in page { changes[entry.collection, default: []].append(entry.record) }
        let last = page.last.map { seqOf($0.record) } ?? since
        return SyncPullResult(changes: changes, serverSeq: last, hasMore: all.count > limit)
    }

    func resetPushCount() { pushedCount = 0 }
}

/// One phone: its own store and its own sync cursor.
@MainActor
private struct Phone {
    let container: ModelContainer
    let engine: SyncEngine
    var context: ModelContext { container.mainContext }

    init(server: FakeServer) throws {
        container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        try VisitStarter.ensureHousehold(in: container.mainContext)
        engine = SyncEngine(defaults: UserDefaults(suiteName: "sync-test-\(UUID())")!)
        engine.configure(transport: server, context: container.mainContext)
    }

    func visits() throws -> [Visit] { try context.fetch(FetchDescriptor<Visit>()) }
    func people() throws -> [Person] { try context.fetch(FetchDescriptor<Person>()) }
}

private let doppio = NearbyPlace(googlePlaceId: "doppio", name: "Doppio Zero", address: "160 Castro St", latitude: 37.39, longitude: -122.08, distanceMeters: 30)

@MainActor
@Test func aVisitCapturedOnOnePhoneArrivesOnAnother() async throws {
    do {
        let server = FakeServer()
        let ted = try Phone(server: server)
        let visit = try VisitStarter.startVisit(at: doppio, participantIds: [Household.tedId, Household.loriId], in: ted.context)
        let burrata = try #require(try DishCapture.addItem(named: "Burrata", to: visit, addedVia: .order, in: ted.context))
        try DishCapture.rate(burrata, .loved, for: .us, enteredBy: Household.tedId, in: ted.context)
        try DishCapture.setVerdict(visit, .wouldReturn, for: .us, enteredBy: Household.tedId, in: ted.context)
        await ted.engine.sync()
        #expect(ted.engine.lastError == nil)

        let other = try Phone(server: server)
        await other.engine.sync()
        #expect(other.engine.lastError == nil)

        let copy = try #require(try other.visits().first)
        #expect(copy.id == visit.id)
        #expect(copy.place?.name == "Doppio Zero")
        #expect(copy.place?.googleAddress == "160 Castro St")
        #expect(copy.participantIds == [Household.tedId, Household.loriId])
        #expect(DishCapture.orderItems(for: copy).map(\.displayName) == ["Burrata"])
        let household = [Household.tedId, Household.loriId]
        #expect(try DishCapture.display(for: DishCapture.orderItems(for: copy)[0], household: household, in: other.context) == .joint(.loved))
        #expect(try DishCapture.verdict(for: copy, household: household, in: other.context) == .joint(.wouldReturn))
        // Ted and Lori have the same ids everywhere, so there's no second Ted.
        #expect(try other.people().count == 2)
    }
}

@MainActor
@Test func changesAndDeletesFlowBothWaysAndUnchangedRecordsArentResent() async throws {
    do {
        let server = FakeServer()
        let a = try Phone(server: server)
        let visit = try VisitStarter.startVisit(at: doppio, participantIds: [Household.tedId], in: a.context)
        let dish = try #require(try DishCapture.addItem(named: "Funghi pizza", to: visit, addedVia: .order, in: a.context))
        await a.engine.sync()
        let b = try Phone(server: server)
        await b.engine.sync()

        // Nothing changed: a second sync sends nothing.
        await server.resetPushCount()
        await a.engine.sync()
        #expect(await server.pushedCount == 0)

        // B rates the dish; A gets it.
        let bVisit = try #require(try b.visits().first)
        let bDish = try #require(DishCapture.orderItems(for: bVisit).first)
        try DishCapture.rate(bDish, .good, for: .us, enteredBy: Household.tedId, in: b.context)
        await b.engine.sync()
        await a.engine.sync()
        #expect(try DishCapture.display(for: dish, household: [Household.tedId], in: a.context) == .joint(.good))

        // A deletes the visit; B sees it gone.
        try PastVisits.delete(visit, in: a.context)
        await a.engine.sync()
        await b.engine.sync()
        #expect(try b.visits().first?.deletedAt != nil)
        #expect(DishCapture.orderItems(for: bVisit).isEmpty)
    }
}

@MainActor
@Test func householdWithOldRandomIdsMovesToTheFixedIds() throws {
    let container = try ModelContainer(for: Schema(tedmarksModelTypes), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    let context = container.mainContext
    let oldTed = Person(displayName: "Ted", kind: .household)
    let oldLori = Person(displayName: "Lori", kind: .household)
    context.insert(oldTed)
    context.insert(oldLori)
    try context.save()
    let oldTedId = oldTed.id
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: [oldTedId, oldLori.id], in: context)
    let dish = try #require(try DishCapture.addItem(named: "Burrata", to: visit, addedVia: .order, in: context))
    try DishCapture.rate(dish, .skip, for: .person(oldTedId), enteredBy: oldTedId, in: context)

    try VisitStarter.ensureHousehold(in: context)

    let people = try context.fetch(FetchDescriptor<Person>())
    #expect(Set(people.map(\.id)) == [Household.tedId, Household.loriId])
    #expect(visit.participantIds == [Household.tedId, Household.loriId])
    let rating = try #require(try DishCapture.ratings(for: dish.id, in: context).first)
    #expect(rating.personId == Household.tedId)
    #expect(rating.enteredByPersonId == Household.tedId)
}

@MainActor
@Test func importedDetailsAndNotesArriveButAreNeverSentBack() async throws {
    let server = FakeServer()
    let placeId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
    let stamp = "2025-06-03T00:00:00.000Z"
    let meta: SyncRecord = ["createdAt": .string(stamp), "modifiedAt": .string(stamp)]
    _ = try await server.syncPush([
        "places": [meta.merging([
            "id": .string(placeId), "kind": .string("restaurant"), "status": .string("beenThere"), "name": .string("State of Mind"),
            "location": .object(["type": .string("Point"), "coordinates": .array([.number(-122.11), .number(37.38)])]),
            "tags": .array([]), "review": .string("Grandma Pie is my favorite."), "refinedRating": .number(9),
            "interest": .object(["level": .string("reallyWantToGo"), "why": .string("Pizza")]),
            "google": .object(["placeId": .string("g1"), "name": .string("State of Mind"), "website": .string("https://example.com"),
                               "openingHours": .object(["weekdayText": .array([.string("Monday: 11 AM–9 PM")])])]),
        ]) { $1 }],
        "notes": [meta.merging(["id": .string("3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f"), "placeId": .string(placeId), "text": .string("salty!")]) { $1 }],
    ])

    let phone = try Phone(server: server)
    await phone.engine.sync()
    let place = try #require(try phone.context.fetch(FetchDescriptor<Place>()).first)
    #expect(place.review == "Grandma Pie is my favorite.")
    #expect(place.refinedRating == 9)
    #expect(place.interestLevelRaw == "reallyWantToGo")
    #expect(place.googleWebsite == "https://example.com")
    #expect(place.googleWeekdayText == ["Monday: 11 AM–9 PM"])
    #expect(try phone.context.fetch(FetchDescriptor<Note>()).map(\.text) == ["salty!"])

    // Only Ted and Lori go up; the place and note came from the server unchanged.
    await server.resetPushCount()
    await phone.engine.sync()
    #expect(await server.pushedCount == 0)
}

@MainActor
@Test func voiceNotesDraftsAndNotesSyncToAnotherPhone() async throws {
    let server = FakeServer()
    let ted = try Phone(server: server)
    let visit = try VisitStarter.startVisit(at: doppio, participantIds: [Household.tedId], in: ted.context)
    let voice = try VoiceDrafts.saveNote(transcript: "Burrata was amazing", durationSec: 4, audioFileName: "a.m4a", visit: visit, in: ted.context)
    let draft = try VoiceDrafts.makeDraft(from: [
        VoiceChange(kind: "itemRating", dishName: "Burrata", value: "loved", evidence: "Burrata was amazing"),
        VoiceChange(kind: "visitNote", text: "Great patio"),
    ], for: voice, visit: visit, in: ted.context)
    try VoiceDrafts.confirm(draft, in: ted.context)
    await ted.engine.sync()
    #expect(ted.engine.lastError == nil)
    #expect(ted.engine.rejected.isEmpty)

    let other = try Phone(server: server)
    await other.engine.sync()
    let copy = try #require(try other.context.fetch(FetchDescriptor<Draft>()).first)
    #expect(copy.status == .confirmed)
    #expect(copy.changes.map(\.kind) == ["itemRating", "visitNote"])
    #expect(copy.changes.first?.evidence == "Burrata was amazing")
    #expect(try other.context.fetch(FetchDescriptor<VoiceNote>()).first?.transcript == "Burrata was amazing")
    #expect(try other.context.fetch(FetchDescriptor<Note>()).map(\.text) == ["Great patio"])
}
