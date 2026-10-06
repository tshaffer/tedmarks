import Foundation
import SwiftData

// Notes and place subtypes (docs/tedmarks-data-model.md §5, §9). Read only on the phone for
// now: they arrive by sync (e.g. memorapp dish comments) and aren't edited here yet.

public enum InterestLevel: String, Codable, Sendable {
    case curious, reallyWantToGo

    public var label: String {
        switch self {
        case .curious: "Curious"
        case .reallyWantToGo: "Really want to go"
        }
    }
}

/// A place-, visit- or dish-level note ("Juicy and lots of garlic").
@Model
public final class Note {
    @Attribute(.unique) public var id: UUID
    public var placeId: UUID
    public var visitId: UUID?
    public var visitItemId: UUID?
    public var personId: UUID?
    public var text: String
    public var originRaw: String
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), placeId: UUID, text: String, origin: String = "typed", now: Date = .now) {
        self.id = id
        self.placeId = placeId
        self.text = text
        self.originRaw = origin
        self.createdAt = now
        self.modifiedAt = now
    }
}

/// A kind of restaurant ("Pizza", "Taqueria").
@Model
public final class PlaceSubtype {
    @Attribute(.unique) public var id: UUID
    public var kindRaw: String
    public var name: String
    public var sortOrder: Int
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), kind: PlaceKind = .restaurant, name: String, sortOrder: Int, now: Date = .now) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.name = name
        self.sortOrder = sortOrder
        self.createdAt = now
        self.modifiedAt = now
    }
}

/// Typed notes about a visit (not tied to a dish), added on the visit's wrap-up.
@MainActor
public enum NoteEditing {
    /// Live notes about the visit itself (dish notes excluded), oldest first.
    public static func visitNotes(for visit: Visit, in context: ModelContext) throws -> [Note] {
        let visitId = visit.id
        return try context.fetch(FetchDescriptor<Note>(
            predicate: #Predicate { $0.visitId == visitId && $0.visitItemId == nil && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.createdAt)]
        ))
    }

    @discardableResult
    public static func addVisitNote(_ text: String, to visit: Visit, in context: ModelContext, now: Date = .now) throws -> Note? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let place = visit.place else { return nil }
        let note = Note(placeId: place.id, text: trimmed, origin: "typed", now: now)
        note.visitId = visit.id
        context.insert(note)
        try context.save()
        SyncEngine.shared.scheduleSync()
        return note
    }

    /// Live notes about one dish on a visit, oldest first.
    public static func dishNotes(for item: VisitItem, in context: ModelContext) throws -> [Note] {
        let itemId = item.id
        return try context.fetch(FetchDescriptor<Note>(
            predicate: #Predicate { $0.visitItemId == itemId && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.createdAt)]
        ))
    }

    @discardableResult
    public static func addDishNote(_ text: String, to item: VisitItem, in context: ModelContext, now: Date = .now) throws -> Note? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let visit = item.visit, let place = visit.place else { return nil }
        let note = Note(placeId: place.id, text: trimmed, origin: "typed", now: now)
        note.visitId = visit.id
        note.visitItemId = item.id
        context.insert(note)
        try context.save()
        SyncEngine.shared.scheduleSync()
        return note
    }

    /// Changes a note's text; an empty text deletes it.
    public static func update(_ note: Note, text: String, in context: ModelContext, now: Date = .now) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            note.deletedAt = now
        } else {
            note.text = trimmed
        }
        note.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    public static func delete(_ note: Note, in context: ModelContext, now: Date = .now) throws {
        note.deletedAt = now
        note.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }
}
