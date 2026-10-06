import Foundation
import SwiftData

// Photos (references into the Photos library, never copies) and menus read by Claude
// (docs/tedmarks-data-model.md §10–11).

public enum PhotoRole: String, Sendable { case visit, menuPage, receipt }

/// A photo in the iPhone Photos library, found again by its identifiers.
@Model
public final class Photo {
    @Attribute(.unique) public var id: UUID
    public var placeId: UUID
    public var visitId: UUID?
    public var menuId: UUID?
    public var roleRaw: String
    /// PHAsset id on the phone that took it.
    public var localIdentifier: String?
    /// PHCloudIdentifier — survives moving to a new phone.
    public var cloudIdentifier: String?
    public var capturedAt: Date
    public var pixelWidth: Int?
    public var pixelHeight: Int?
    public var capturedByPersonId: UUID
    public var taggedVisitItemIds: [UUID]
    /// ok, or missing (deleted from Photos).
    public var availabilityRaw: String
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), placeId: UUID, role: PhotoRole, localIdentifier: String?, cloudIdentifier: String?,
                capturedAt: Date, capturedBy: UUID, now: Date = .now) {
        self.id = id
        self.placeId = placeId
        self.roleRaw = role.rawValue
        self.localIdentifier = localIdentifier
        self.cloudIdentifier = cloudIdentifier
        self.capturedAt = capturedAt
        self.capturedByPersonId = capturedBy
        self.taggedVisitItemIds = []
        self.availabilityRaw = "ok"
        self.createdAt = now
        self.modifiedAt = now
    }

    public var role: PhotoRole { PhotoRole(rawValue: roleRaw) ?? .visit }
}

/// A dish read from a menu photo.
public struct MenuItem: Codable, Hashable, Sendable {
    public var section: String?
    public var name: String
    public var price: String?

    public init(section: String?, name: String, price: String?) {
        self.section = section
        self.name = name
        self.price = price
    }
}

public enum MenuReadStatus: String, Sendable { case pending, read, failed }

/// A menu capture: its page photos (in order) and the dishes Claude read from them.
/// (Called PlaceMenu because SwiftUI already has a `Menu`.)
@Model
public final class PlaceMenu {
    @Attribute(.unique) public var id: UUID
    public var placeId: UUID
    public var visitId: UUID?
    public var capturedAt: Date
    public var pagePhotoIds: [UUID]
    public var readStatusRaw: String
    public var readAt: Date?
    /// [MenuItem] as JSON, in menu order.
    public var extractedData: Data?
    public var createdAt: Date
    public var modifiedAt: Date
    public var deletedAt: Date?

    public init(id: UUID = UUID(), placeId: UUID, visitId: UUID?, pagePhotoIds: [UUID], now: Date = .now) {
        self.id = id
        self.placeId = placeId
        self.visitId = visitId
        self.capturedAt = now
        self.pagePhotoIds = pagePhotoIds
        self.readStatusRaw = MenuReadStatus.pending.rawValue
        self.createdAt = now
        self.modifiedAt = now
    }

    public var readStatus: MenuReadStatus {
        get { MenuReadStatus(rawValue: readStatusRaw) ?? .pending }
        set { readStatusRaw = newValue.rawValue }
    }

    public var extracted: [MenuItem]? {
        get { extractedData.flatMap { try? JSONDecoder().decode([MenuItem].self, from: $0) } }
        set { extractedData = newValue.flatMap { try? JSONEncoder().encode($0) } }
    }
}

/// Menu capture: record the pages, then turn what Claude read into the place's dishes.
@MainActor
public enum MenuReading {
    /// A new menu for the place, waiting to be read. Pages are Photo ids, in order.
    @discardableResult
    public static func startMenu(place: Place, visit: Visit?, pages: [Photo], in context: ModelContext, now: Date = .now) throws -> PlaceMenu {
        let menu = PlaceMenu(placeId: place.id, visitId: visit?.id, pagePhotoIds: pages.map(\.id), now: now)
        context.insert(menu)
        for page in pages {
            page.menuId = menu.id
            page.modifiedAt = now
        }
        try context.save()
        SyncEngine.shared.scheduleSync()
        return menu
    }

    /// Claude's reading: each dish becomes (or updates) one of the place's dishes, marked as on
    /// the latest menu; dishes not on it are marked off it (shown greyed, still choosable).
    public static func apply(_ items: [MenuItem], to menu: PlaceMenu, in context: ModelContext, now: Date = .now) throws {
        let placeId = menu.placeId
        guard let place = try context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.id == placeId })).first else { return }
        var byName = Dictionary(place.items.filter { $0.deletedAt == nil }.map { ($0.normalizedName, $0) }) { first, _ in first }
        var onMenu = Set<UUID>()
        for entry in items {
            let normalized = normalizeItemName(entry.name)
            guard !normalized.isEmpty else { continue }
            let item: PlaceItem
            if let existing = byName[normalized] {
                item = existing
                if !item.sources.contains("menu") { item.sources.append("menu") }
            } else {
                item = PlaceItem(place: place, name: entry.name, source: "menu", now: now)
                context.insert(item)
                byName[normalized] = item
            }
            item.section = entry.section
            item.price = entry.price
            item.onLatestMenu = true
            item.modifiedAt = now
            onMenu.insert(item.id)
        }
        for item in byName.values where !onMenu.contains(item.id) && item.onLatestMenu != false {
            item.onLatestMenu = false
            item.modifiedAt = now
        }
        menu.extracted = items
        menu.readStatus = .read
        menu.readAt = now
        menu.modifiedAt = now
        place.latestMenuId = menu.id
        place.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    public static func markFailed(_ menu: PlaceMenu, in context: ModelContext, now: Date = .now) throws {
        menu.readStatus = .failed
        menu.modifiedAt = now
        try context.save()
    }

    /// The place's newest menu (read or still being read).
    public static func latestMenu(for place: Place, in context: ModelContext) throws -> PlaceMenu? {
        let placeId = place.id
        var descriptor = FetchDescriptor<PlaceMenu>(
            predicate: #Predicate { $0.placeId == placeId && $0.deletedAt == nil },
            sortBy: [SortDescriptor(\.capturedAt, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    /// "On the menu" choices: the latest menu's dishes in menu order, grouped by its sections.
    public static func sections(for place: Place, in context: ModelContext) throws -> [(title: String?, items: [PlaceItem])] {
        guard let menuId = place.latestMenuId,
              let menu = try context.fetch(FetchDescriptor<PlaceMenu>(predicate: #Predicate { $0.id == menuId })).first,
              let extracted = menu.extracted
        else { return [] }
        let byName = Dictionary(place.items.filter { $0.deletedAt == nil }.map { ($0.normalizedName, $0) }) { first, _ in first }
        var sections: [(title: String?, items: [PlaceItem])] = []
        var seen = Set<UUID>()
        for entry in extracted {
            guard let item = byName[normalizeItemName(entry.name)], seen.insert(item.id).inserted else { continue }
            if let last = sections.last, last.title == entry.section {
                sections[sections.count - 1].items.append(item)
            } else {
                sections.append((entry.section, [item]))
            }
        }
        return sections
    }
}
