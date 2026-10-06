import Foundation
import SwiftData

// Dishes and ratings (docs/tedmarks-data-model.md §6, §8). Ratings reference their
// subject by id (not a relationship) so they sync as flat records.

/// An item at a place — a dish, for restaurants.
@Model
public final class PlaceItem {
    @Attribute(.unique) public var id: UUID
    public var place: Place?
    public var name: String
    public var normalizedName: String
    public var section: String?
    /// As printed on the latest menu ("18", "$14.50").
    public var price: String?
    /// PlaceItemSource raw values: menu, order, receipt, voice, manual, imported.
    public var sources: [String]
    public var onLatestMenu: Bool?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), place: Place, name: String, source: String, now: Date = .now) {
        self.id = id
        self.place = place
        self.name = name
        self.normalizedName = normalizeItemName(name)
        self.sources = [source]
        self.createdAt = now
        self.modifiedAt = now
    }
}

public enum VisitItemAddedVia: String, Codable, Sendable {
    case order, rating, receipt, voice, sameAsLastTime, imported
}

/// A dish in our order on a visit.
@Model
public final class VisitItem {
    @Attribute(.unique) public var id: UUID
    public var visit: Visit?
    public var placeItem: PlaceItem?
    /// "Dish 3" until named.
    public var placeholderLabel: String?
    public var ordered: Bool
    public var addedViaRaw: String
    public var sortOrder: Int
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public var displayName: String { placeItem?.name ?? placeholderLabel ?? "Dish" }

    public init(
        id: UUID = UUID(), visit: Visit, placeItem: PlaceItem?, placeholderLabel: String? = nil,
        addedVia: VisitItemAddedVia, sortOrder: Int, now: Date = .now
    ) {
        self.id = id
        self.visit = visit
        self.placeItem = placeItem
        self.placeholderLabel = placeholderLabel
        self.ordered = true
        self.addedViaRaw = addedVia.rawValue
        self.sortOrder = sortOrder
        self.createdAt = now
        self.modifiedAt = now
    }
}

public enum RatingSubjectType: String, Codable, Sendable { case visit, visitItem }
public enum RatingOrigin: String, Codable, Sendable { case tap, notification, draft, imported }

/// A visit verdict or dish rating — joint ("Us") or for one person.
/// One per (subject, scope, person); "joint unless we disagree" is computed when displayed.
@Model
public final class Rating {
    @Attribute(.unique) public var id: UUID
    public var subjectTypeRaw: String
    public var subjectId: UUID
    public var visitId: UUID
    public var placeId: UUID
    public var scopeRaw: String
    public var personId: UUID?
    /// VerdictValue or ItemRatingValue raw value, depending on subjectType.
    public var valueRaw: String
    /// Person who entered it (Ted entering Lori's rating is allowed). User ids come with sign-in.
    public var enteredByPersonId: UUID?
    public var originRaw: String
    public var importedScore: Int?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(
        id: UUID = UUID(), subjectType: RatingSubjectType, subjectId: UUID, visitId: UUID, placeId: UUID,
        scope: RatingScope, personId: UUID?, valueRaw: String, enteredByPersonId: UUID?,
        origin: RatingOrigin = .tap, now: Date = .now
    ) {
        self.id = id
        self.subjectTypeRaw = subjectType.rawValue
        self.subjectId = subjectId
        self.visitId = visitId
        self.placeId = placeId
        self.scopeRaw = scope.rawValue
        self.personId = personId
        self.valueRaw = valueRaw
        self.enteredByPersonId = enteredByPersonId
        self.originRaw = origin.rawValue
        self.createdAt = now
        self.modifiedAt = now
    }

    public var scope: RatingScope { RatingScope(rawValue: scopeRaw) ?? .joint }
}

/// Lowercase, trim, collapse whitespace. Mirrors normalizeItemName in shared/src/schema/item.ts.
public func normalizeItemName(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
}
