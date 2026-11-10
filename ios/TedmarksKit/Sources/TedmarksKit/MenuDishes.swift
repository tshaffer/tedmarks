import Foundation
import SwiftData

// Adding pages to a menu, checking what Claude read, and editing the dish list (the website has
// the same rules: shared/src/rules/menuDishes.ts and web/src/data/menuWrites.ts).

public enum MenuDishStatus: String, Codable, Sendable {
    /// Not on the menu yet.
    case new
    /// On it at another price.
    case changed
    /// Already on it as it is.
    case same
}

/// A dish from the latest reading, waiting to be checked.
public struct MenuReviewItem: Codable, Hashable, Sendable {
    public var section: String?
    public var name: String
    public var price: String?
    public var description: String?
    public var status: MenuDishStatus
    /// The menu's price before this reading, when it changed.
    public var previousPrice: String?

    public init(_ item: MenuItem, status: MenuDishStatus, previousPrice: String? = nil) {
        section = item.section
        name = item.name
        price = item.price
        description = item.description
        self.status = status
        self.previousPrice = previousPrice
    }

    public var item: MenuItem { MenuItem(section: section, name: name, price: price, description: description) }
}

/// What the last reading found, until someone checks it ("Menu read: review").
public struct MenuReview: Codable, Hashable, Sendable {
    public var readAt: Date
    /// The pages that were read.
    public var pageIds: [UUID]
    public var items: [MenuReviewItem]

    public init(readAt: Date, pageIds: [UUID], items: [MenuReviewItem]) {
        self.readAt = readAt
        self.pageIds = pageIds
        self.items = items
    }
}

public enum MenuDishError: Error, Equatable, LocalizedError {
    case emptyName
    case alreadyOnMenu(String)
    case alreadyHere(String)
    case gone

    public var errorDescription: String? {
        switch self {
        case .emptyName: "A dish needs a name."
        case .alreadyOnMenu(let name): "“\(name)” is already on the menu."
        case .alreadyHere(let name): "There’s already “\(name)” here. To make them one dish, use Merge dishes on the website."
        case .gone: "That dish is gone."
        }
    }
}

public enum MenuDishes {
    static func clean(_ text: String?) -> String? {
        let cleaned = text?.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return cleaned?.isEmpty == false ? cleaned : nil
    }

    private static func samePrice(_ a: String?, _ b: String?) -> Bool {
        (a ?? "").filter { !$0.isWhitespace } == (b ?? "").filter { !$0.isWhitespace }
    }

    /// How each dish read from new pages compares with the menu's dishes (same name = same dish).
    public static func compare(existing: [MenuItem], read: [MenuItem]) -> [MenuReviewItem] {
        let byName = Dictionary(existing.map { (normalizeItemName($0.name), $0) }) { first, _ in first }
        return read.map { dish in
            guard let current = byName[normalizeItemName(dish.name)] else { return MenuReviewItem(dish, status: .new) }
            if let price = dish.price, !samePrice(price, current.price) { return MenuReviewItem(dish, status: .changed, previousPrice: current.price) }
            return MenuReviewItem(dish, status: .same)
        }
    }

    /// The menu's dishes with the checked ones added: one already there gets the new price (and
    /// the description, if it had none); a new one goes after the last dish of its section.
    public static func merge(existing: [MenuItem], checked: [MenuItem]) -> [MenuItem] {
        var result = existing
        for dish in checked {
            guard let name = clean(dish.name) else { continue }
            let key = normalizeItemName(name)
            if let index = result.firstIndex(where: { normalizeItemName($0.name) == key }) {
                if let price = dish.price { result[index].price = price }
                if result[index].description == nil, let description = dish.description { result[index].description = description }
                continue
            }
            let added = MenuItem(section: dish.section, name: name, price: dish.price, description: dish.description)
            if let section = dish.section, let last = result.lastIndex(where: { $0.section == section }) {
                result.insert(added, at: last + 1)
            } else {
                result.append(added)
            }
        }
        return result
    }
}

/// One line of a checked reading: what Claude read (nil = added by hand) and what it became (nil = removed).
public struct MenuReviewEdit: Sendable {
    public var original: MenuReviewItem?
    public var edited: MenuItem?

    public init(original: MenuReviewItem?, edited: MenuItem?) {
        self.original = original
        self.edited = edited
    }
}

extension MenuReading {
    /// A new menu's reading: as `apply`, then waiting to be checked against the menu before it.
    public static func applyNew(_ items: [MenuItem], to menu: PlaceMenu, previous: [MenuItem], in context: ModelContext, now: Date = .now) throws {
        menu.review = MenuReview(readAt: now, pageIds: menu.pages.map(\.id), items: MenuDishes.compare(existing: previous, read: items))
        try apply(items, to: menu, in: context, now: now)
    }

    /// Pages added to a menu: their dishes join its list and become (or update) the place's
    /// dishes — nothing is marked off — and the reading waits to be checked.
    public static func applyAdded(_ items: [MenuItem], pageIds: [UUID], to menu: PlaceMenu, in context: ModelContext, now: Date = .now) throws {
        let before = menu.extracted ?? []
        let placeId = menu.placeId
        guard let place = try context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.id == placeId })).first else { return }
        for entry in items { upsertDish(entry, at: place, fillOnly: true, in: context, now: now) }
        menu.extracted = MenuDishes.merge(existing: before, checked: items)
        menu.review = MenuReview(readAt: now, pageIds: pageIds, items: MenuDishes.compare(existing: before, read: items))
        menu.readStatus = .read
        menu.readAt = now
        menu.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    /// Edits the menu's dish list: `index` is the dish to change (or remove, with nil), or the
    /// list's length to add one. The place's dish follows: renamed (everywhere it was ordered),
    /// repriced, or taken off the menu (visits that ordered it keep it).
    public static func editDish(in menu: PlaceMenu, at index: Int, to new: MenuItem?, in context: ModelContext, now: Date = .now) throws {
        var entries = menu.extracted ?? []
        let adding = index == entries.count
        guard adding || entries.indices.contains(index) else { throw MenuDishError.gone }
        let placeId = menu.placeId
        guard let place = try context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.id == placeId })).first else { throw MenuDishError.gone }
        let live = place.items.filter { $0.deletedAt == nil }
        let current = adding ? nil : entries[index]
        let item = current.flatMap { entry in live.first { $0.normalizedName == normalizeItemName(entry.name) } }

        guard let new else {
            entries.remove(at: index)
            if let item, place.latestMenuId == menu.id, !entries.contains(where: { normalizeItemName($0.name) == item.normalizedName }) {
                item.onLatestMenu = false
                item.modifiedAt = now
            }
            try save(entries, to: menu, in: context, now: now)
            return
        }

        guard let name = MenuDishes.clean(new.name) else { throw MenuDishError.emptyName }
        let dish = MenuItem(section: MenuDishes.clean(new.section), name: name, price: MenuDishes.clean(new.price), description: MenuDishes.clean(new.description))
        let normalized = normalizeItemName(name)
        if let clash = entries.indices.first(where: { $0 != index && normalizeItemName(entries[$0].name) == normalized }) {
            throw MenuDishError.alreadyOnMenu(entries[clash].name)
        }
        let other = live.first { $0.id != item?.id && $0.normalizedName == normalized }
        if let item {
            if item.normalizedName != normalized, let other { throw MenuDishError.alreadyHere(other.name) }
            item.name = name
            item.normalizedName = normalized
            item.section = dish.section
            item.price = dish.price
            item.onLatestMenu = true
            item.modifiedAt = now
        } else {
            upsertDish(dish, at: place, fillOnly: false, in: context, now: now)
        }
        if adding { entries.append(dish) } else { entries[index] = dish }
        try save(entries, to: menu, in: context, now: now)
        if item != nil { VisitSideEffects.reconcile(in: context) }
    }

    /// Applies what was changed while checking a reading, then clears the review. Removing a
    /// new dish takes it off the menu; removing a changed one puts its old price back.
    public static func finishReview(_ menu: PlaceMenu, edits: [MenuReviewEdit], in context: ModelContext, now: Date = .now) throws {
        func index(of name: String) -> Int? {
            (menu.extracted ?? []).firstIndex { normalizeItemName($0.name) == normalizeItemName(name) }
        }
        for edit in edits {
            switch (edit.original, edit.edited) {
            case (nil, let added?):
                try editDish(in: menu, at: menu.extracted?.count ?? 0, to: added, in: context, now: now)
            case (let original?, nil):
                guard let i = index(of: original.name) else { continue }
                if original.status == .new {
                    try editDish(in: menu, at: i, to: nil, in: context, now: now)
                } else if original.status == .changed, var reverted = menu.extracted?[i] {
                    reverted.price = original.previousPrice
                    try editDish(in: menu, at: i, to: reverted, in: context, now: now)
                }
            case (let original?, let edited?):
                guard edited != original.item else { continue }
                if let i = index(of: original.name) {
                    try editDish(in: menu, at: i, to: edited, in: context, now: now)
                } else {
                    try editDish(in: menu, at: menu.extracted?.count ?? 0, to: edited, in: context, now: now)
                }
            case (nil, nil):
                continue
            }
        }
        menu.review = nil
        menu.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }

    /// The place's dish for a menu entry: found by name (and marked on the menu) or made.
    /// `fillOnly` keeps a section or price the entry doesn't have.
    static func upsertDish(_ entry: MenuItem, at place: Place, fillOnly: Bool, in context: ModelContext, now: Date) {
        guard let name = MenuDishes.clean(entry.name) else { return }
        let normalized = normalizeItemName(name)
        let item: PlaceItem
        if let existing = place.items.first(where: { $0.deletedAt == nil && $0.normalizedName == normalized }) {
            item = existing
            if !item.sources.contains("menu") { item.sources.append("menu") }
        } else {
            item = PlaceItem(place: place, name: name, source: "menu", now: now)
            context.insert(item)
        }
        if !fillOnly || entry.section != nil { item.section = entry.section }
        if !fillOnly || entry.price != nil { item.price = entry.price }
        item.onLatestMenu = true
        item.modifiedAt = now
    }

    private static func save(_ entries: [MenuItem], to menu: PlaceMenu, in context: ModelContext, now: Date) throws {
        menu.extracted = entries
        menu.modifiedAt = now
        try context.save()
        SyncEngine.shared.scheduleSync()
    }
}
