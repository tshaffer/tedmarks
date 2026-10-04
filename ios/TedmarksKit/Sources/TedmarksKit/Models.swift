import Foundation
import SwiftData

// On-device models (SwiftData). Field names follow docs/tedmarks-data-model.md and
// shared/src/schema. Enums are stored as raw strings so records sync as-is.
// Sync fields still to add with sign-in: createdBy/modifiedBy (user ids) and serverSeq.

public enum PlaceKind: String, Codable, Sendable { case restaurant }
public enum PlaceStatus: String, Codable, Sendable { case wantToGo, beenThere }
public enum PersonKind: String, Codable, Sendable { case household, guest }
public enum VisitStatus: String, Codable, Sendable { case inProgress, ended }
public enum VisitOrigin: String, Codable, Sendable { case startVisit, photoSuggestion, receipt, manual, imported }

@Model
public final class Person {
    @Attribute(.unique) public var id: UUID
    public var displayName: String
    public var kindRaw: String
    public var lastSeenAt: Date?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public var kind: PersonKind {
        get { PersonKind(rawValue: kindRaw) ?? .guest }
        set { kindRaw = newValue.rawValue }
    }

    public init(id: UUID = UUID(), displayName: String, kind: PersonKind, now: Date = .now) {
        self.id = id
        self.displayName = displayName
        self.kindRaw = kind.rawValue
        self.createdAt = now
        self.modifiedAt = now
    }
}

@Model
public final class Place {
    @Attribute(.unique) public var id: UUID
    public var kindRaw: String
    public var statusRaw: String
    public var name: String
    public var latitude: Double
    public var longitude: Double
    public var tags: [String]

    // Google snapshot (subset for now)
    public var googlePlaceId: String?
    public var googleAddress: String?
    public var googlePrimaryType: String?
    public var googlePrimaryTypeLabel: String?
    public var googleFetchedAt: Date?

    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \Visit.place)
    public var visits: [Visit] = []

    @Relationship(deleteRule: .cascade, inverse: \PlaceItem.place)
    public var items: [PlaceItem] = []

    public var kind: PlaceKind {
        get { PlaceKind(rawValue: kindRaw) ?? .restaurant }
        set { kindRaw = newValue.rawValue }
    }

    public var status: PlaceStatus {
        get { PlaceStatus(rawValue: statusRaw) ?? .wantToGo }
        set { statusRaw = newValue.rawValue }
    }

    public init(
        id: UUID = UUID(),
        kind: PlaceKind = .restaurant,
        status: PlaceStatus,
        name: String,
        latitude: Double,
        longitude: Double,
        now: Date = .now
    ) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.statusRaw = status.rawValue
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.tags = []
        self.createdAt = now
        self.modifiedAt = now
    }
}

@Model
public final class Visit {
    @Attribute(.unique) public var id: UUID
    public var place: Place?
    public var startedAt: Date
    public var endedAt: Date?
    public var statusRaw: String
    public var originRaw: String
    public var participantIds: [UUID]
    public var isFirstVisit: Bool
    public var tags: [String]
    public var wrapUpCompletedAt: Date?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \VisitItem.visit)
    public var items: [VisitItem] = []

    public var status: VisitStatus {
        get { VisitStatus(rawValue: statusRaw) ?? .ended }
        set { statusRaw = newValue.rawValue }
    }

    public var origin: VisitOrigin {
        get { VisitOrigin(rawValue: originRaw) ?? .manual }
        set { originRaw = newValue.rawValue }
    }

    public init(
        id: UUID = UUID(),
        place: Place,
        startedAt: Date = .now,
        origin: VisitOrigin,
        participantIds: [UUID],
        isFirstVisit: Bool
    ) {
        self.id = id
        self.place = place
        self.startedAt = startedAt
        self.statusRaw = VisitStatus.inProgress.rawValue
        self.originRaw = origin.rawValue
        self.participantIds = participantIds
        self.isFirstVisit = isFirstVisit
        self.tags = []
        self.createdAt = startedAt
        self.modifiedAt = startedAt
    }
}

/// All SwiftData model types, for building a ModelContainer.
public let tedmarksModelTypes: [any PersistentModel.Type] = [
    Person.self, Place.self, Visit.self, PlaceItem.self, VisitItem.self, Rating.self,
]
