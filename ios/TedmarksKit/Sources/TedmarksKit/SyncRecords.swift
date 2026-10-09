import CryptoKit
import Foundation
import SwiftData

// How on-device records map to the server's synced records (shared/src/schema).
// Each record is sent as the fields this app keeps; `null` clears a field and fields
// the app doesn't know about (e.g. a review written on the web) are left alone.

/// Any JSON value. Records are built by hand so nil can be sent as an explicit `null`.
public enum JSONValue: Codable, Hashable, Sendable {
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
    case placeSubtypes, people, places, placeItems, visits, visitItems, ratings, notes, voiceNotes, drafts, photos, menus

    /// Received but never sent: the phone doesn't edit these yet.
    var isReadOnly: Bool { self == .placeSubtypes }
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
                "subtypeId": SyncValue.id(place.subtypeId),
                "latestMenuId": SyncValue.id(place.latestMenuId),
                "review": SyncValue.string(place.review),
                "interest": place.interestLevel.map { level in
                    .object([
                        "level": .string(level.rawValue),
                        "why": SyncValue.string(place.interestWhy),
                        "savedAt": SyncValue.date(place.interestSavedAt ?? place.createdAt),
                    ])
                } ?? .null,
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
                "price": SyncValue.string(item.price),
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
        var record = base(id: item.id, createdAt: item.createdAt, modifiedAt: item.modifiedAt, deletedAt: item.deletedAt)
        // Only lines that have ever had a quantity carry the field (null once back to one), so
        // every other line's record — and its sync hash — is unchanged.
        if item.quantity != nil { record["quantity"] = item.count > 1 ? .number(Double(item.count)) : .null }
        return record
            .merging([
                "visitId": SyncValue.id(visit.id),
                "placeItemId": SyncValue.id(item.placeItem?.id),
                "placeholderLabel": SyncValue.string(item.placeholderLabel),
                "ordered": .bool(item.ordered),
                "addedVia": .string(item.addedViaRaw),
                "sortOrder": .number(Double(item.sortOrder)),
            ]) { $1 }
    }

    static func record(_ note: Note) -> SyncRecord {
        base(id: note.id, createdAt: note.createdAt, modifiedAt: note.modifiedAt, deletedAt: note.deletedAt)
            .merging([
                "placeId": SyncValue.id(note.placeId),
                "visitId": SyncValue.id(note.visitId),
                "visitItemId": SyncValue.id(note.visitItemId),
                "personId": SyncValue.id(note.personId),
                "text": .string(note.text),
                "origin": .string(note.originRaw),
            ]) { $1 }
    }

    static func record(_ note: VoiceNote) -> SyncRecord {
        base(id: note.id, createdAt: note.createdAt, modifiedAt: note.modifiedAt, deletedAt: note.deletedAt)
            .merging([
                "visitId": SyncValue.id(note.visitId),
                "personId": SyncValue.id(note.personId),
                "recordedAt": SyncValue.date(note.recordedAt),
                "durationSec": .number(note.durationSec),
                "transcript": .string(note.transcript),
                "audioLocalPath": SyncValue.string(note.audioFileName),
                "structuredAt": SyncValue.date(note.structuredAt),
                "draftId": SyncValue.id(note.draftId),
            ]) { $1 }
    }

    static func record(_ draft: Draft) -> SyncRecord {
        // Inside an array, leave absent fields out (null only clears top-level/nested fields).
        let changes: [JSONValue] = draft.changes.map { change in
            var object: [String: JSONValue] = [
                "id": SyncValue.id(change.id),
                "kind": .string(change.kind),
                "keep": .bool(change.keep),
                "payload": .object(change.payload),
            ]
            if let evidence = change.evidence { object["evidence"] = .string(evidence) }
            if let personId = change.personId { object["personId"] = SyncValue.id(personId) }
            return .object(object)
        }
        return base(id: draft.id, createdAt: draft.createdAt, modifiedAt: draft.modifiedAt, deletedAt: draft.deletedAt)
            .merging([
                "visitId": SyncValue.id(draft.visitId),
                "placeId": SyncValue.id(draft.placeId),
                "sourceType": .string(draft.sourceTypeRaw),
                "sourceId": SyncValue.id(draft.sourceId),
                "status": .string(draft.statusRaw),
                "changes": .array(changes),
                "confirmedAt": SyncValue.date(draft.confirmedAt),
            ]) { $1 }
    }

    static func record(_ photo: Photo) -> SyncRecord {
        base(id: photo.id, createdAt: photo.createdAt, modifiedAt: photo.modifiedAt, deletedAt: photo.deletedAt)
            .merging([
                "placeId": SyncValue.id(photo.placeId),
                "visitId": SyncValue.id(photo.visitId),
                "menuId": SyncValue.id(photo.menuId),
                "role": .string(photo.roleRaw),
                "storage": .string("photosLibrary"),
                "localIdentifier": SyncValue.string(photo.localIdentifier),
                "cloudIdentifier": SyncValue.string(photo.cloudIdentifier),
                "capturedAt": SyncValue.date(photo.capturedAt),
                "pixelWidth": SyncValue.int(photo.pixelWidth),
                "pixelHeight": SyncValue.int(photo.pixelHeight),
                "capturedByPersonId": SyncValue.id(photo.capturedByPersonId),
                "taggedVisitItemIds": .array(photo.taggedVisitItemIds.map { SyncValue.id($0) }),
                "availability": .string(photo.availabilityRaw),
            ]) { $1 }
    }

    static func record(_ menu: PlaceMenu) -> SyncRecord {
        // Inside an array, leave absent fields out (null only clears top-level/nested fields).
        let extracted: JSONValue = menu.extracted.map { items in
            .array(items.map { item in
                var object: [String: JSONValue] = ["name": .string(item.name)]
                if let section = item.section { object["section"] = .string(section) }
                if let price = item.price { object["price"] = .string(price) }
                return .object(object)
            })
        } ?? .null
        return base(id: menu.id, createdAt: menu.createdAt, modifiedAt: menu.modifiedAt, deletedAt: menu.deletedAt)
            .merging([
                "placeId": SyncValue.id(menu.placeId),
                "visitId": SyncValue.id(menu.visitId),
                "capturedAt": SyncValue.date(menu.capturedAt),
                "pagePhotoIds": .array(menu.pagePhotoIds.map { SyncValue.id($0) }),
                "readStatus": .string(menu.readStatusRaw),
                "readAt": SyncValue.date(menu.readAt),
                "extracted": extracted,
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
    var voiceNotes: [UUID: VoiceNote] = [:]
    var drafts: [UUID: Draft] = [:]
    var photos: [UUID: Photo] = [:]
    var menus: [UUID: PlaceMenu] = [:]

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
        voiceNotes = try byId(VoiceNote.self) { $0.id }
        drafts = try byId(Draft.self) { $0.id }
        photos = try byId(Photo.self) { $0.id }
        menus = try byId(PlaceMenu.self) { $0.id }
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
        case .notes: notes.values.map { n in (n.id, SyncEncoder.record(n), n.modifiedAt, { n.modifiedAt = $0 }) }
        case .voiceNotes: voiceNotes.values.map { v in (v.id, SyncEncoder.record(v), v.modifiedAt, { v.modifiedAt = $0 }) }
        case .drafts: drafts.values.map { d in (d.id, SyncEncoder.record(d), d.modifiedAt, { d.modifiedAt = $0 }) }
        case .photos: photos.values.map { p in (p.id, SyncEncoder.record(p), p.modifiedAt, { p.modifiedAt = $0 }) }
        case .menus: menus.values.map { m in (m.id, SyncEncoder.record(m), m.modifiedAt, { m.modifiedAt = $0 }) }
        case .placeSubtypes: []
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
        case .notes: notes[id].map(SyncEncoder.record)
        case .voiceNotes: voiceNotes[id].map(SyncEncoder.record)
        case .drafts: drafts[id].map(SyncEncoder.record)
        case .photos: photos[id].map(SyncEncoder.record)
        case .menus: menus[id].map(SyncEncoder.record)
        case .placeSubtypes: nil
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
        case .voiceNotes: voiceNotes[id]?.modifiedAt
        case .drafts: drafts[id]?.modifiedAt
        case .photos: photos[id]?.modifiedAt
        case .menus: menus[id]?.modifiedAt
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
            place.interestSavedAt = SyncValue.parseDate(interest?["savedAt"])
            place.latestMenuId = SyncValue.parseId(record["latestMenuId"])
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
            item.price = string("price")
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
            if let quantity = record["quantity"]?.number, quantity > 1 {
                item.quantity = Int(quantity)
            } else if item.quantity != nil {
                item.quantity = 1
            }
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

        case .voiceNotes:
            guard let visitId = SyncValue.parseId(record["visitId"]),
                  let personId = SyncValue.parseId(record["personId"]) else { return false }
            let recordedAt = SyncValue.parseDate(record["recordedAt"]) ?? createdAt
            let voice = local.voiceNotes[id] ?? {
                let new = VoiceNote(id: id, visitId: visitId, personId: personId, recordedAt: recordedAt,
                                    durationSec: 0, transcript: "", audioFileName: nil)
                context.insert(new)
                local.voiceNotes[id] = new
                return new
            }()
            voice.visitId = visitId
            voice.personId = personId
            voice.recordedAt = recordedAt
            voice.durationSec = record["durationSec"]?.number ?? 0
            voice.transcript = string("transcript") ?? ""
            voice.audioFileName = string("audioLocalPath")
            voice.structuredAt = SyncValue.parseDate(record["structuredAt"])
            voice.draftId = SyncValue.parseId(record["draftId"])
            voice.createdAt = createdAt
            voice.modifiedAt = modifiedAt
            voice.deletedAt = deletedAt

        case .drafts:
            guard let visitId = SyncValue.parseId(record["visitId"]),
                  let placeId = SyncValue.parseId(record["placeId"]),
                  let sourceId = SyncValue.parseId(record["sourceId"]) else { return false }
            let changes: [ProposedChange] = (record["changes"]?.array ?? []).compactMap { value in
                guard let object = value.object, let changeId = SyncValue.parseId(object["id"]),
                      let kind = object["kind"]?.string else { return nil }
                return ProposedChange(id: changeId, kind: kind, keep: object["keep"]?.bool ?? true,
                                      evidence: object["evidence"]?.string, personId: SyncValue.parseId(object["personId"]),
                                      payload: object["payload"]?.object ?? [:])
            }
            let draft = local.drafts[id] ?? {
                let new = Draft(id: id, visitId: visitId, placeId: placeId, sourceId: sourceId, changes: [], now: createdAt)
                context.insert(new)
                local.drafts[id] = new
                return new
            }()
            draft.visitId = visitId
            draft.placeId = placeId
            draft.sourceTypeRaw = string("sourceType") ?? draft.sourceTypeRaw
            draft.sourceId = sourceId
            draft.statusRaw = string("status") ?? draft.statusRaw
            draft.changes = changes
            draft.confirmedAt = SyncValue.parseDate(record["confirmedAt"])
            draft.createdAt = createdAt
            draft.modifiedAt = modifiedAt
            draft.deletedAt = deletedAt

        case .photos:
            guard let placeId = SyncValue.parseId(record["placeId"]),
                  let capturedBy = SyncValue.parseId(record["capturedByPersonId"]) else { return false }
            let photo = local.photos[id] ?? {
                let new = Photo(id: id, placeId: placeId, role: .visit, localIdentifier: nil, cloudIdentifier: nil,
                                capturedAt: createdAt, capturedBy: capturedBy, now: createdAt)
                context.insert(new)
                local.photos[id] = new
                return new
            }()
            photo.placeId = placeId
            photo.visitId = SyncValue.parseId(record["visitId"])
            photo.menuId = SyncValue.parseId(record["menuId"])
            photo.roleRaw = string("role") ?? photo.roleRaw
            photo.localIdentifier = string("localIdentifier")
            photo.cloudIdentifier = string("cloudIdentifier")
            photo.capturedAt = SyncValue.parseDate(record["capturedAt"]) ?? createdAt
            photo.pixelWidth = record["pixelWidth"]?.number.map { Int($0) }
            photo.pixelHeight = record["pixelHeight"]?.number.map { Int($0) }
            photo.capturedByPersonId = capturedBy
            photo.taggedVisitItemIds = record["taggedVisitItemIds"]?.array?.compactMap { SyncValue.parseId($0) } ?? []
            photo.availabilityRaw = string("availability") ?? "ok"
            photo.createdAt = createdAt
            photo.modifiedAt = modifiedAt
            photo.deletedAt = deletedAt

        case .menus:
            guard let placeId = SyncValue.parseId(record["placeId"]) else { return false }
            let menu = local.menus[id] ?? {
                let new = PlaceMenu(id: id, placeId: placeId, visitId: nil, pagePhotoIds: [], now: createdAt)
                context.insert(new)
                local.menus[id] = new
                return new
            }()
            menu.placeId = placeId
            menu.visitId = SyncValue.parseId(record["visitId"])
            menu.capturedAt = SyncValue.parseDate(record["capturedAt"]) ?? createdAt
            menu.pagePhotoIds = record["pagePhotoIds"]?.array?.compactMap { SyncValue.parseId($0) } ?? []
            menu.readStatusRaw = string("readStatus") ?? menu.readStatusRaw
            menu.readAt = SyncValue.parseDate(record["readAt"])
            menu.extracted = record["extracted"]?.array.map { items in
                items.compactMap { value in
                    guard let object = value.object, let name = object["name"]?.string else { return nil }
                    return MenuItem(section: object["section"]?.string, name: name, price: object["price"]?.string)
                }
            }
            menu.createdAt = createdAt
            menu.modifiedAt = modifiedAt
            menu.deletedAt = deletedAt
        }
        return true
    }
}
