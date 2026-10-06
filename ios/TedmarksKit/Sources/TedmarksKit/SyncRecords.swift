import CryptoKit
import Foundation
import SwiftData

// How on-device records map to the server's synced records (shared/src/schema).
// Each record is sent as the fields this app keeps; `null` clears a field and fields
// the app doesn't know about (e.g. a review written on the web) are left alone.

/// Any JSON value. Records are built by hand so nil can be sent as an explicit `null`.
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var string: String? { if case .string(let value) = self { value } else { nil } }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
    var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
    var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
    var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
}

public typealias SyncRecord = [String: JSONValue]

/// The collections this app syncs, in the order they must be applied (parents first).
public enum SyncCollection: String, CaseIterable, Sendable {
    case placeSubtypes, people, places, placeItems, visits, visitItems, ratings, notes

    /// Received but never sent: the phone doesn't edit these yet.
    var isReadOnly: Bool { self == .placeSubtypes || self == .notes }
}

/// What was last sent to or received from the server for one record, so local edits can be
/// found by comparing hashes (every change is caught, whether or not it bumped modifiedAt).
@Model
public final class SyncRecordState {
    // Not `key`/`hash`: those clash with NSObject/Core Data properties underneath SwiftData.
    /// "<collection>/<id>"
    @Attribute(.unique) public var recordKey: String
    public var recordHash: String
    public var modifiedAt: Date

    init(recordKey: String, recordHash: String, modifiedAt: Date) {
        self.recordKey = recordKey
        self.recordHash = recordHash
        self.modifiedAt = modifiedAt
    }
}

// MARK: - Values

enum SyncValue {
    private static let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutFraction = Date.ISO8601FormatStyle()

    static func date(_ date: Date?) -> JSONValue { date.map { .string($0.formatted(withFraction)) } ?? .null }
    static func id(_ id: UUID?) -> JSONValue { id.map { .string($0.uuidString.lowercased()) } ?? .null }
    static func string(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
    static func int(_ value: Int?) -> JSONValue { value.map { .number(Double($0)) } ?? .null }
    static func bool(_ value: Bool?) -> JSONValue { value.map(JSONValue.bool) ?? .null }
    static func strings(_ values: [String]) -> JSONValue { .array(values.map(JSONValue.string)) }

    static func parseDate(_ value: JSONValue?) -> Date? {
        guard let text = value?.string else { return nil }
        return (try? withFraction.parse(text)) ?? (try? withoutFraction.parse(text))
    }
    static func parseId(_ value: JSONValue?) -> UUID? { value?.string.flatMap(UUID.init(uuidString:)) }

    static func hash(_ record: SyncRecord) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = (try? encoder.encode(record)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Encoding (device → server)

@MainActor
enum SyncEncoder {
    /// Until sign-in, every change is recorded as Ted's (the only user).
    static var userId: JSONValue { SyncValue.id(Household.tedId) }

    private static func base(id: UUID, createdAt: Date, modifiedAt: Date, deletedAt: Date?) -> SyncRecord {
        [
            "id": SyncValue.id(id),
            "createdAt": SyncValue.date(createdAt),
            "createdBy": userId,
            "modifiedAt": SyncValue.date(modifiedAt),
            "modifiedBy": userId,
            "deletedAt": SyncValue.date(deletedAt),
        ]
    }

    static func record(_ person: Person) -> SyncRecord {
        base(id: person.id, createdAt: person.createdAt, modifiedAt: person.modifiedAt, deletedAt: person.deletedAt)
            .merging([
                "displayName": .string(person.displayName),
                "kind": .string(person.kindRaw),
                "lastSeenAt": SyncValue.date(person.lastSeenAt),
            ]) { $1 }
    }

    static func record(_ place: Place) -> SyncRecord {
        let google: JSONValue = place.googlePlaceId.map { googleId in
            .object([
                "placeId": .string(googleId),
                "name": .string(place.name),
                "formattedAddress": SyncValue.string(place.googleAddress),
                "primaryType": SyncValue.string(place.googlePrimaryType),
                "primaryTypeLabel": SyncValue.string(place.googlePrimaryTypeLabel),
                "fetchedAt": SyncValue.date(place.googleFetchedAt ?? place.createdAt),
            ])
        } ?? .null
        return base(id: place.id, createdAt: place.createdAt, modifiedAt: place.modifiedAt, deletedAt: place.deletedAt)
            .merging([
                "kind": .string(place.kindRaw),
                "status": .string(place.statusRaw),
                "name": .string(place.name),
                "location": .object(["type": .string("Point"), "coordinates": .array([.number(place.longitude), .number(place.latitude)])]),
                "tags": SyncValue.strings(place.tags),
                "google": google,
            ]) { $1 }
    }

    static func record(_ item: PlaceItem) -> SyncRecord? {
        guard let place = item.place else { return nil }
        return base(id: item.id, createdAt: item.createdAt, modifiedAt: item.modifiedAt, deletedAt: item.deletedAt)
            .merging([
                "placeId": SyncValue.id(place.id),
                "name": .string(item.name),
                "normalizedName": .string(item.normalizedName),
                "section": SyncValue.string(item.section),
                "sources": SyncValue.strings(item.sources),
                "onLatestMenu": SyncValue.bool(item.onLatestMenu),
            ]) { $1 }
    }

    static func record(_ visit: Visit) -> SyncRecord? {
        guard let place = visit.place else { return nil }
        return base(id: visit.id, createdAt: visit.createdAt, modifiedAt: visit.modifiedAt, deletedAt: visit.deletedAt)
            .merging([
                "placeId": SyncValue.id(place.id),
                "startedAt": SyncValue.date(visit.startedAt),
                "endedAt": SyncValue.date(visit.endedAt),
                "status": .string(visit.statusRaw),
                "origin": .string(visit.originRaw),
                "participantIds": .array(visit.participantIds.map { SyncValue.id($0) }),
                "isFirstVisit": .bool(visit.isFirstVisit),
                "tags": SyncValue.strings(visit.tags),
                "wrapUpCompletedAt": SyncValue.date(visit.wrapUpCompletedAt),
            ]) { $1 }
    }

    static func record(_ item: VisitItem) -> SyncRecord? {
        guard let visit = item.visit else { return nil }
        return base(id: item.id, createdAt: item.createdAt, modifiedAt: item.modifiedAt, deletedAt: item.deletedAt)
            .merging([
                "visitId": SyncValue.id(visit.id),
                "placeItemId": SyncValue.id(item.placeItem?.id),
                "placeholderLabel": SyncValue.string(item.placeholderLabel),
                "ordered": .bool(item.ordered),
                "addedVia": .string(item.addedViaRaw),
                "sortOrder": .number(Double(item.sortOrder)),
            ]) { $1 }
    }

    static func record(_ rating: Rating) -> SyncRecord {
        base(id: rating.id, createdAt: rating.createdAt, modifiedAt: rating.modifiedAt, deletedAt: rating.deletedAt)
            .merging([
                "subjectType": .string(rating.subjectTypeRaw),
                "subjectId": SyncValue.id(rating.subjectId),
                "visitId": SyncValue.id(rating.visitId),
                "placeId": SyncValue.id(rating.placeId),
                "scope": .string(rating.scopeRaw),
                "personId": SyncValue.id(rating.personId),
                "value": .string(rating.valueRaw),
                "enteredBy": SyncValue.id(rating.enteredByPersonId ?? Household.tedId),
                "origin": .string(rating.originRaw),
                "importedScore": SyncValue.int(rating.importedScore),
            ]) { $1 }
    }
}

// MARK: - Local records

/// Every local record of every synced collection, by id, so incoming records can find their
/// existing copy and their parents (place, visit, dish) without a fetch per record.
@MainActor
struct LocalRecords {
    var people: [UUID: Person] = [:]
    var places: [UUID: Place] = [:]
    var placeItems: [UUID: PlaceItem] = [:]
    var visits: [UUID: Visit] = [:]
    var visitItems: [UUID: VisitItem] = [:]
    var ratings: [UUID: Rating] = [:]
    var placeSubtypes: [UUID: PlaceSubtype] = [:]
    var notes: [UUID: Note] = [:]

    init(context: ModelContext) throws {
        func byId<T: PersistentModel>(_ type: T.Type, _ id: (T) -> UUID) throws -> [UUID: T] {
            Dictionary(try context.fetch(FetchDescriptor<T>()).map { (id($0), $0) }) { first, _ in first }
        }
        people = try byId(Person.self) { $0.id }
        places = try byId(Place.self) { $0.id }
        placeItems = try byId(PlaceItem.self) { $0.id }
        visits = try byId(Visit.self) { $0.id }
        visitItems = try byId(VisitItem.self) { $0.id }
        ratings = try byId(Rating.self) { $0.id }
        placeSubtypes = try byId(PlaceSubtype.self) { $0.id }
        notes = try byId(Note.self) { $0.id }
    }

    /// Each local record as it would be sent (records whose parent is missing are skipped),
    /// with its modifiedAt and a way to bump that when it changed without one.
    func encoded(_ collection: SyncCollection) -> [(id: UUID, record: SyncRecord, modifiedAt: Date, touch: (Date) -> Void)] {
        switch collection {
        case .people: people.values.map { p in (p.id, SyncEncoder.record(p), p.modifiedAt, { p.modifiedAt = $0 }) }
        case .places: places.values.map { p in (p.id, SyncEncoder.record(p), p.modifiedAt, { p.modifiedAt = $0 }) }
        case .placeItems: placeItems.values.compactMap { i in SyncEncoder.record(i).map { (i.id, $0, i.modifiedAt, { i.modifiedAt = $0 }) } }
        case .visits: visits.values.compactMap { v in SyncEncoder.record(v).map { (v.id, $0, v.modifiedAt, { v.modifiedAt = $0 }) } }
        case .visitItems: visitItems.values.compactMap { i in SyncEncoder.record(i).map { (i.id, $0, i.modifiedAt, { i.modifiedAt = $0 }) } }
        case .ratings: ratings.values.map { r in (r.id, SyncEncoder.record(r), r.modifiedAt, { r.modifiedAt = $0 }) }
        case .placeSubtypes, .notes: []
        }
    }

    /// The current encoding of one local record, if it exists.
    func encoded(_ collection: SyncCollection, id: UUID) -> SyncRecord? {
        switch collection {
        case .people: people[id].map(SyncEncoder.record)
        case .places: places[id].map(SyncEncoder.record)
        case .placeItems: placeItems[id].flatMap(SyncEncoder.record)
        case .visits: visits[id].flatMap(SyncEncoder.record)
        case .visitItems: visitItems[id].flatMap(SyncEncoder.record)
        case .ratings: ratings[id].map(SyncEncoder.record)
        case .placeSubtypes, .notes: nil
        }
    }

    func modifiedAt(_ collection: SyncCollection, id: UUID) -> Date? {
        switch collection {
        case .people: people[id]?.modifiedAt
        case .places: places[id]?.modifiedAt
        case .placeItems: placeItems[id]?.modifiedAt
        case .visits: visits[id]?.modifiedAt
        case .visitItems: visitItems[id]?.modifiedAt
        case .ratings: ratings[id]?.modifiedAt
        case .placeSubtypes: placeSubtypes[id]?.modifiedAt
        case .notes: notes[id]?.modifiedAt
        }
    }
}

// MARK: - Decoding (server → device)

@MainActor
enum SyncDecoder {
    /// Creates or updates the local copy of a server record. Returns false if it can't be
    /// applied (bad id, or its place/visit isn't on this phone).
    @discardableResult
    static func apply(_ record: SyncRecord, to collection: SyncCollection, local: inout LocalRecords, context: ModelContext) -> Bool {
        guard let id = SyncValue.parseId(record["id"]) else { return false }
        let createdAt = SyncValue.parseDate(record["createdAt"]) ?? .now
        let modifiedAt = SyncValue.parseDate(record["modifiedAt"]) ?? createdAt
        let deletedAt = SyncValue.parseDate(record["deletedAt"])
        let string = { (key: String) in record[key]?.string }

        switch collection {
        case .people:
            let person = local.people[id] ?? {
                let new = Person(id: id, displayName: string("displayName") ?? "Someone", kind: .guest, now: createdAt)
                context.insert(new)
                local.people[id] = new
                return new
            }()
            person.displayName = string("displayName") ?? person.displayName
            person.kindRaw = string("kind") ?? person.kindRaw
            person.lastSeenAt = SyncValue.parseDate(record["lastSeenAt"])
            person.createdAt = createdAt
            person.modifiedAt = modifiedAt
            person.deletedAt = deletedAt

        case .places:
            let coordinates = record["location"]?.object?["coordinates"]?.array?.compactMap(\.number) ?? []
            guard coordinates.count == 2 else { return false }
            let place = local.places[id] ?? {
                let new = Place(id: id, status: .beenThere, name: string("name") ?? "Place",
                                latitude: coordinates[1], longitude: coordinates[0], now: createdAt)
                context.insert(new)
                local.places[id] = new
                return new
            }()
            place.kindRaw = string("kind") ?? place.kindRaw
            place.statusRaw = string("status") ?? place.statusRaw
            place.name = string("name") ?? place.name
            place.longitude = coordinates[0]
            place.latitude = coordinates[1]
            place.tags = record["tags"]?.array?.compactMap(\.string) ?? []
            let google = record["google"]?.object
            place.googlePlaceId = google?["placeId"]?.string
            place.googleAddress = google?["formattedAddress"]?.string
            place.googlePrimaryType = google?["primaryType"]?.string
            place.googlePrimaryTypeLabel = google?["primaryTypeLabel"]?.string
            place.googleFetchedAt = SyncValue.parseDate(google?["fetchedAt"])
            place.googleWebsite = google?["website"]?.string
            place.googlePhone = google?["phone"]?.string
            place.googleRating = google?["rating"]?.number
            place.googleRatingsCount = google?["ratingsCount"]?.number.map { Int($0) }
            place.googlePriceLevel = google?["priceLevel"]?.number.map { Int($0) }
            place.googleWeekdayText = google?["openingHours"]?.object?["weekdayText"]?.array?.compactMap(\.string)
            place.subtypeId = SyncValue.parseId(record["subtypeId"])
            place.review = string("review")
            place.refinedRating = record["refinedRating"]?.number.map { Int($0) }
            let interest = record["interest"]?.object
            place.interestLevelRaw = interest?["level"]?.string
            place.interestWhy = interest?["why"]?.string
            place.createdAt = createdAt
            place.modifiedAt = modifiedAt
            place.deletedAt = deletedAt

        case .placeItems:
            guard let place = SyncValue.parseId(record["placeId"]).flatMap({ local.places[$0] }) else { return false }
            let item = local.placeItems[id] ?? {
                let new = PlaceItem(id: id, place: place, name: string("name") ?? "Dish", source: "manual", now: createdAt)
                context.insert(new)
                local.placeItems[id] = new
                return new
            }()
            item.place = place
            item.name = string("name") ?? item.name
            item.normalizedName = string("normalizedName") ?? normalizeItemName(item.name)
            item.section = string("section")
            item.sources = record["sources"]?.array?.compactMap(\.string) ?? []
            item.onLatestMenu = record["onLatestMenu"]?.bool
            item.createdAt = createdAt
            item.modifiedAt = modifiedAt
            item.deletedAt = deletedAt

        case .visits:
            guard let place = SyncValue.parseId(record["placeId"]).flatMap({ local.places[$0] }) else { return false }
            let startedAt = SyncValue.parseDate(record["startedAt"]) ?? createdAt
            let visit = local.visits[id] ?? {
                let new = Visit(id: id, place: place, startedAt: startedAt, origin: .manual, participantIds: [], isFirstVisit: false)
                context.insert(new)
                local.visits[id] = new
                return new
            }()
            visit.place = place
            visit.startedAt = startedAt
            visit.endedAt = SyncValue.parseDate(record["endedAt"])
            visit.statusRaw = string("status") ?? visit.statusRaw
            visit.originRaw = string("origin") ?? visit.originRaw
            visit.participantIds = record["participantIds"]?.array?.compactMap { SyncValue.parseId($0) } ?? []
            visit.isFirstVisit = record["isFirstVisit"]?.bool ?? visit.isFirstVisit
            visit.tags = record["tags"]?.array?.compactMap(\.string) ?? []
            visit.wrapUpCompletedAt = SyncValue.parseDate(record["wrapUpCompletedAt"])
            visit.createdAt = createdAt
            visit.modifiedAt = modifiedAt
            visit.deletedAt = deletedAt

        case .visitItems:
            guard let visit = SyncValue.parseId(record["visitId"]).flatMap({ local.visits[$0] }) else { return false }
            let placeItem = SyncValue.parseId(record["placeItemId"]).flatMap { local.placeItems[$0] }
            let addedVia = VisitItemAddedVia(rawValue: string("addedVia") ?? "") ?? .order
            let sortOrder = Int(record["sortOrder"]?.number ?? 0)
            let item = local.visitItems[id] ?? {
                let new = VisitItem(id: id, visit: visit, placeItem: placeItem, addedVia: addedVia, sortOrder: sortOrder, now: createdAt)
                context.insert(new)
                local.visitItems[id] = new
                return new
            }()
            item.visit = visit
            item.placeItem = placeItem
            item.placeholderLabel = string("placeholderLabel")
            item.ordered = record["ordered"]?.bool ?? true
            item.addedViaRaw = addedVia.rawValue
            item.sortOrder = sortOrder
            item.createdAt = createdAt
            item.modifiedAt = modifiedAt
            item.deletedAt = deletedAt

        case .ratings:
            guard let subjectId = SyncValue.parseId(record["subjectId"]),
                  let visitId = SyncValue.parseId(record["visitId"]),
                  let placeId = SyncValue.parseId(record["placeId"]),
                  let value = string("value")
            else { return false }
            let rating = local.ratings[id] ?? {
                let new = Rating(
                    id: id, subjectType: RatingSubjectType(rawValue: string("subjectType") ?? "") ?? .visitItem,
                    subjectId: subjectId, visitId: visitId, placeId: placeId,
                    scope: RatingScope(rawValue: string("scope") ?? "") ?? .joint, personId: nil,
                    valueRaw: value, enteredByPersonId: nil, now: createdAt
                )
                context.insert(new)
                local.ratings[id] = new
                return new
            }()
            rating.subjectTypeRaw = string("subjectType") ?? rating.subjectTypeRaw
            rating.subjectId = subjectId
            rating.visitId = visitId
            rating.placeId = placeId
            rating.scopeRaw = string("scope") ?? rating.scopeRaw
            rating.personId = SyncValue.parseId(record["personId"])
            rating.valueRaw = value
            rating.enteredByPersonId = SyncValue.parseId(record["enteredBy"])
            rating.originRaw = string("origin") ?? rating.originRaw
            rating.importedScore = record["importedScore"]?.number.map { Int($0) }
            rating.createdAt = createdAt
            rating.modifiedAt = modifiedAt
            rating.deletedAt = deletedAt

        case .placeSubtypes:
            let subtype = local.placeSubtypes[id] ?? {
                let new = PlaceSubtype(id: id, name: string("name") ?? "Restaurant", sortOrder: 0, now: createdAt)
                context.insert(new)
                local.placeSubtypes[id] = new
                return new
            }()
            subtype.kindRaw = string("kind") ?? subtype.kindRaw
            subtype.name = string("name") ?? subtype.name
            subtype.sortOrder = Int(record["sortOrder"]?.number ?? 0)
            subtype.createdAt = createdAt
            subtype.modifiedAt = modifiedAt
            subtype.deletedAt = deletedAt

        case .notes:
            guard let placeId = SyncValue.parseId(record["placeId"]), let text = string("text") else { return false }
            let note = local.notes[id] ?? {
                let new = Note(id: id, placeId: placeId, text: text, now: createdAt)
                context.insert(new)
                local.notes[id] = new
                return new
            }()
            note.placeId = placeId
            note.visitId = SyncValue.parseId(record["visitId"])
            note.visitItemId = SyncValue.parseId(record["visitItemId"])
            note.personId = SyncValue.parseId(record["personId"])
            note.text = text
            note.originRaw = string("origin") ?? note.originRaw
            note.createdAt = createdAt
            note.modifiedAt = modifiedAt
            note.deletedAt = deletedAt
        }
        return true
    }
}
