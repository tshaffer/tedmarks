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
