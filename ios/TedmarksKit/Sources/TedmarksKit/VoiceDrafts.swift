import Foundation
import SwiftData

// Hold-to-talk voice notes and the drafts Claude proposes from them
// (docs/tedmarks-data-model.md §12). Nothing is applied until it's confirmed.

/// A hold-to-talk recording. The audio stays on this phone; the transcript syncs.
@Model
public final class VoiceNote {
    @Attribute(.unique) public var id: UUID
    public var visitId: UUID
    public var personId: UUID
    public var recordedAt: Date
    public var durationSec: Double
    public var transcript: String
    /// File name in the voice notes folder (App Group), when the audio was kept.
    public var audioFileName: String?
    /// When it was sent to Claude.
    public var structuredAt: Date?
    public var draftId: UUID?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), visitId: UUID, personId: UUID, recordedAt: Date, durationSec: Double, transcript: String, audioFileName: String?) {
        self.id = id
        self.visitId = visitId
        self.personId = personId
        self.recordedAt = recordedAt
        self.durationSec = durationSec
        self.transcript = transcript
        self.audioFileName = audioFileName
        self.createdAt = recordedAt
        self.modifiedAt = recordedAt
    }
}

/// One proposed change in a draft, as stored and synced (ProposedChange in shared/src/schema/voice.ts).
public struct ProposedChange: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var kind: String
    /// ✓ (apply) or ✕ (skip) in the review screen.
    public var keep: Bool
    public var evidence: String?
    public var personId: UUID?
    /// dishId, dishName, value, text — whichever the kind uses.
    public var payload: [String: JSONValue]

    public var dishId: UUID? { payload["dishId"]?.string.flatMap(UUID.init(uuidString:)) }
    public var dishName: String? { payload["dishName"]?.string }
    public var value: String? { payload["value"]?.string }
    public var text: String? { payload["text"]?.string }
}

public enum DraftStatus: String, Sendable { case pending, confirmed, dismissed }

/// Changes Claude proposed from a voice note, waiting for confirmation.
@Model
public final class Draft {
    @Attribute(.unique) public var id: UUID
    public var visitId: UUID
    public var placeId: UUID
    public var sourceTypeRaw: String
    public var sourceId: UUID
    public var statusRaw: String
    /// [ProposedChange] as JSON.
    public var changesData: Data
    public var confirmedAt: Date?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), visitId: UUID, placeId: UUID, sourceId: UUID, changes: [ProposedChange], now: Date = .now) {
        self.id = id
        self.visitId = visitId
        self.placeId = placeId
        self.sourceTypeRaw = "voiceNote"
        self.sourceId = sourceId
        self.statusRaw = DraftStatus.pending.rawValue
        self.changesData = (try? JSONEncoder().encode(changes)) ?? Data("[]".utf8)
        self.createdAt = now
        self.modifiedAt = now
    }

    public var status: DraftStatus {
        get { DraftStatus(rawValue: statusRaw) ?? .pending }
        set { statusRaw = newValue.rawValue }
    }

    public var changes: [ProposedChange] {
        get { (try? JSONDecoder().decode([ProposedChange].self, from: changesData)) ?? [] }
        set { changesData = (try? JSONEncoder().encode(newValue)) ?? changesData }
    }
}

/// What the phone sends to POST /ai/voice (VoiceStructureRequest in shared/src/api/voice.ts).
public struct VoiceStructureRequest: Encodable, Sendable {
    public struct Named: Encodable, Sendable { public var id: String; public var name: String }
    public var transcript: String
    public var placeName: String
    public var participants: [Named]
    public var dishes: [Named]
    public var orderedBefore: [Named]
}

/// One change as Claude proposed it (VoiceChange in shared/src/api/voice.ts).
public struct VoiceChange: Codable, Hashable, Sendable {
    public var kind: String
    public var dishId: String?
    public var dishName: String?
    public var personId: String?
    public var value: String?
    public var text: String?
    public var evidence: String

    public init(kind: String, dishId: String? = nil, dishName: String? = nil, personId: String? = nil,
                value: String? = nil, text: String? = nil, evidence: String = "") {
        self.kind = kind
        self.dishId = dishId
        self.dishName = dishName
        self.personId = personId
        self.value = value
        self.text = text
        self.evidence = evidence
    }
}

@MainActor
public enum VoiceDrafts {

    /// Saves a recording's transcript as a voice note on the visit.
    @discardableResult
    public static func saveNote(
        transcript: String, durationSec: Double, audioFileName: String?, visit: Visit,
        in context: ModelContext, now: Date = .now
    ) throws -> VoiceNote {
        let speaker = try VisitStarter.devicePerson(in: context)?.id ?? Household.tedId
        let note = VoiceNote(visitId: visit.id, personId: speaker, recordedAt: now, durationSec: durationSec,
                             transcript: transcript, audioFileName: audioFileName)
        context.insert(note)
        try context.save()
        SyncEngine.shared.scheduleSync()
        return note
    }

    /// Everything Claude needs to match names: the place, who's there (speaker first),
    /// our order, and dishes from earlier visits.
    public static func request(for note: VoiceNote, visit: Visit, in context: ModelContext) throws -> VoiceStructureRequest {
        let people = try context.fetch(FetchDescriptor<Person>())
        let byId = Dictionary(uniqueKeysWithValues: people.map { ($0.id, $0) })
        var participantIds = visit.participantIds
        if let speaker = participantIds.firstIndex(of: note.personId) {
            participantIds.insert(participantIds.remove(at: speaker), at: 0)
        } else {
            participantIds.insert(note.personId, at: 0)
        }
        let participants = participantIds.compactMap { id in
            byId[id].map { VoiceStructureRequest.Named(id: id.uuidString, name: $0.displayName) }
        }
        let dishes = DishCapture.orderItems(for: visit).map { VoiceStructureRequest.Named(id: $0.id.uuidString, name: $0.displayName) }
        let previous = visit.place.map { DishCapture.orderedBefore(at: $0, excluding: visit) } ?? []
        return VoiceStructureRequest(
            transcript: note.transcript,
            placeName: visit.place?.name ?? "Restaurant",
            participants: participants,
            dishes: dishes,
            orderedBefore: previous.prefix(200).map { VoiceStructureRequest.Named(id: $0.id.uuidString, name: $0.name) }
        )
    }

    /// Stores Claude's proposals as a pending draft (all ✓ to start).
    @discardableResult
    public static func makeDraft(from changes: [VoiceChange], for note: VoiceNote, visit: Visit,
                                 in context: ModelContext, now: Date = .now) throws -> Draft {
        let proposed = changes.map { change in
            var payload: [String: JSONValue] = [:]
            if let dishId = change.dishId { payload["dishId"] = .string(dishId) }
            if let dishName = change.dishName { payload["dishName"] = .string(dishName) }
            if let value = change.value { payload["value"] = .string(value) }
            if let text = change.text { payload["text"] = .string(text) }
            return ProposedChange(id: UUID(), kind: change.kind, keep: true,
                                  evidence: change.evidence.isEmpty ? nil : change.evidence,
                                  personId: change.personId.flatMap(UUID.init(uuidString:)), payload: payload)
        }
        let draft = Draft(visitId: visit.id, placeId: visit.place?.id ?? visit.id, sourceId: note.id, changes: proposed, now: now)
        context.insert(draft)
        note.draftId = draft.id
        note.structuredAt = now
        note.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
        return draft
    }

    /// Applies the kept changes as ordinary ratings, dishes, notes and tags, then marks the
    /// draft confirmed. Ratings are recorded with origin "draft".
    public static func confirm(_ draft: Draft, in context: ModelContext, now: Date = .now) throws {
        let visitId = draft.visitId
        guard let visit = try context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { $0.id == visitId })).first,
              let place = visit.place
        else { throw VoiceDraftError.visitMissing }
        let me = try VisitStarter.devicePerson(in: context)?.id
        var dishes: [String: VisitItem] = [:]

        func dish(for change: ProposedChange) throws -> VisitItem? {
            let key = change.dishId?.uuidString ?? normalizeItemName(change.dishName ?? "")
            if let cached = dishes[key] { return cached }
            var item: VisitItem?
            if let id = change.dishId {
                item = DishCapture.orderItems(for: visit).first { $0.id == id }
                if item == nil, let placeItem = place.items.first(where: { $0.id == id && $0.deletedAt == nil }) {
                    item = try DishCapture.addItem(placeItem, to: visit, addedVia: .voice, in: context, now: now)
                }
            }
            if item == nil, let name = change.dishName {
                item = try DishCapture.addItem(named: name, to: visit, addedVia: .voice, in: context, now: now)
            }
            if let item { dishes[key] = item }
            return item
        }
        let rateFor = { (change: ProposedChange) -> RateFor in change.personId.map(RateFor.person) ?? .us }

        // Dishes and ratings first, so notes attach to the same dishes.
        let kept = draft.changes.filter(\.keep)
        for change in kept.sorted(by: { order($0.kind) < order($1.kind) }) {
            switch change.kind {
            case "addItem":
                _ = try dish(for: change)
            case "itemRating":
                if let item = try dish(for: change), let value = change.value.flatMap(ItemRatingValue.init) {
                    try DishCapture.rate(item, value, for: rateFor(change), enteredBy: me, origin: .draft, in: context, now: now)
                }
            case "verdict":
                if let value = change.value.flatMap(VerdictValue.init) {
                    try DishCapture.setVerdict(visit, value, for: rateFor(change), enteredBy: me, origin: .draft, in: context, now: now)
                }
            case "itemNote", "visitNote":
                guard let text = change.text, !text.isEmpty else { continue }
                let note = Note(placeId: place.id, text: text, origin: "voice", now: now)
                note.visitId = visit.id
                note.personId = change.personId
                if change.kind == "itemNote" { note.visitItemId = try dish(for: change)?.id }
                context.insert(note)
            case "visitTag":
                if let tag = change.text, !tag.isEmpty, !visit.tags.contains(tag) {
                    visit.tags.append(tag)
                    visit.modifiedAt = now
                }
            default:
                continue
            }
        }
        draft.status = .confirmed
        draft.confirmedAt = now
        draft.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }

    public static func dismiss(_ draft: Draft, in context: ModelContext, now: Date = .now) throws {
        draft.status = .dismissed
        draft.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    private static func order(_ kind: String) -> Int {
        switch kind {
        case "addItem": 0
        case "itemRating": 1
        case "verdict": 2
        default: 3
        }
    }
}

public enum VoiceDraftError: LocalizedError {
    case visitMissing
    public var errorDescription: String? { "The visit for this note is no longer on this phone." }
}
