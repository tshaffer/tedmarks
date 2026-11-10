import Foundation
import Observation
import SwiftData
import TedmarksKit
import UniformTypeIdentifiers

/// Adding menu pages: they're kept on the phone and sent to the server, and Claude reads them
/// in the background. The dishes are usable at once; "Menu read: review" then asks to check
/// them. Shared so reading continues after the screen that started it closes, and readings
/// that couldn't happen (offline) are tried again when the app comes back.
@MainActor
@Observable
final class MenuCapture {
    static let shared = MenuCapture()

    /// Menus being read right now.
    private(set) var reading: Set<UUID> = []
    var message: String?

    private let defaults = UserDefaults.standard
    /// Menu id → the pages still to be read ("all" pages for a new menu).
    private static let pendingKey = "menuCapture.pendingReads"

    /// New pages for the place's menu: added to its latest menu, or (`replace`, or no menu
    /// yet) a new menu whose old pages are deleted.
    func add(_ pages: [PreparedMenuPage], place: Place, visit: Visit?, replace: Bool, in context: ModelContext) async {
        guard !pages.isEmpty else { return }
        let cache = MenuPageCache.shared
        do {
            for page in pages { try cache.add(page.data, id: page.id, mediaType: page.mediaType) }
        } catch {
            message = "Couldn’t keep the pages on this phone: \(error.localizedDescription)"
            return
        }
        Task { await cache.flush(using: AppConfig.api) }

        let refs = pages.map(\.ref)
        let latest = latestMenu(of: place, in: context)
        do {
            if let latest, !replace, latest.readStatus == .read {
                latest.pages += refs
                latest.modifiedAt = .now
                try context.save()
                SyncEngine.shared.scheduleSync()
                await read(latest, newPages: refs.map(\.id), sending: pages.flatMap(\.forReading), place: place, in: context)
            } else {
                let menu = try MenuReading.startMenu(place: place, visit: visit, pages: [], in: context)
                menu.pages = refs
                if replace, let latest {
                    cache.remove(latest.pages.map(\.id))
                    latest.pages = []
                    latest.modifiedAt = .now
                }
                try context.save()
                SyncEngine.shared.scheduleSync()
                await read(menu, newPages: nil, sending: pages.flatMap(\.forReading), place: place, in: context)
            }
        } catch {
            message = error.localizedDescription
        }
    }

    /// Reads what couldn't be read before (offline, or the app closed while reading).
    func resumePending(in context: ModelContext) async {
        for (key, pageKeys) in pending {
            guard let menuId = UUID(uuidString: key), !reading.contains(menuId) else { continue }
            guard let menu = try? context.fetch(FetchDescriptor<PlaceMenu>(predicate: #Predicate { $0.id == menuId })).first,
                  menu.deletedAt == nil, let place = place(of: menu, in: context)
            else { setPending(menuId, nil); continue }
            let ids = pageKeys == ["all"] ? nil : pageKeys.compactMap(UUID.init(uuidString:))
            await retry(menu, newPages: ids, place: place, in: context)
        }
    }

    /// Reads a menu again (after a failed or offline try): its own pages, or older menus' Photos.
    func retry(_ menu: PlaceMenu, place: Place, in context: ModelContext) async {
        if menu.pages.isEmpty {
            await retryFromPhotos(menu, place: place, in: context)
        } else {
            let pending = pending[menu.id.uuidString.lowercased()]
            await retry(menu, newPages: pending.flatMap { $0 == ["all"] ? nil : $0.compactMap(UUID.init(uuidString:)) }, place: place, in: context)
        }
    }

    #if DEBUG
    /// Dev/testing: reads image or PDF files as a new menu without the camera (`-menuImage <path>`).
    func debugRead(files: [String], place: Place, visit: Visit?, in context: ModelContext) async {
        let pages = files.compactMap { path -> PreparedMenuPage? in
            guard let data = FileManager.default.contents(atPath: path) else { return nil }
            return try? MenuFiles.file(data, type: .init(filenameExtension: (path as NSString).pathExtension), name: path)
        }
        await add(pages, place: place, visit: visit, replace: false, in: context)
    }

    func debugAdd(files: [String], place: Place, replace: Bool, in context: ModelContext) async {
        let pages = files.compactMap { path -> PreparedMenuPage? in
            guard let data = FileManager.default.contents(atPath: path) else { return nil }
            return try? MenuFiles.file(data, type: .init(filenameExtension: (path as NSString).pathExtension), name: path)
        }
        await add(pages, place: place, visit: nil, replace: replace, in: context)
    }
    #endif

    // MARK: - Private

    private func latestMenu(of place: Place, in context: ModelContext) -> PlaceMenu? {
        let placeId = place.id
        let menus = (try? context.fetch(FetchDescriptor<PlaceMenu>(predicate: #Predicate { $0.placeId == placeId && $0.deletedAt == nil }))) ?? []
        if let id = place.latestMenuId, let menu = menus.first(where: { $0.id == id }) { return menu }
        return menus.max { $0.capturedAt < $1.capturedAt }
    }

    private func place(of menu: PlaceMenu, in context: ModelContext) -> Place? {
        let placeId = menu.placeId
        return try? context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.id == placeId })).first
    }

    private func retry(_ menu: PlaceMenu, newPages: [UUID]?, place: Place, in context: ModelContext) async {
        let ids = newPages ?? menu.pages.map(\.id)
        var sending: [TedmarksAPI.MenuReadPage] = []
        for ref in menu.pages where ids.contains(ref.id) {
            guard let data = try? await MenuPageCache.shared.data(for: ref.id, using: AppConfig.api),
                  let prepared = try? MenuFiles.file(data, type: UTTypeFor(ref.mediaType), name: "A page")
            else { continue }
            sending += prepared.forReading
        }
        guard !sending.isEmpty else {
            setPending(menu.id, ids.map(\.uuidString))
            return
        }
        await read(menu, newPages: newPages, sending: sending, place: place, in: context)
    }

    /// `newPages` nil: a whole new menu (checked against the one before it).
    private func read(_ menu: PlaceMenu, newPages: [UUID]?, sending: [TedmarksAPI.MenuReadPage], place: Place, in context: ModelContext) async {
        setPending(menu.id, newPages.map { $0.map(\.uuidString) } ?? ["all"])
        reading.insert(menu.id)
        defer { reading.remove(menu.id) }
        do {
            let items = try await AppConfig.api.readMenu(placeName: place.name, pages: sending)
            if let newPages {
                try MenuReading.applyAdded(items, pageIds: newPages, to: menu, in: context)
            } else {
                let previous = latestMenu(of: place, in: context).flatMap { $0.id == menu.id ? nil : $0.extracted } ?? []
                try MenuReading.applyNew(items, to: menu, previous: previous, in: context)
            }
            setPending(menu.id, nil)
            if items.isEmpty { message = "Claude didn’t find any dishes on those pages." }
        } catch TedmarksAPIError.unreachable {
            // Kept as pending: read when the app is next opened online.
        } catch {
            setPending(menu.id, nil)
            if menu.readStatus == .pending { try? MenuReading.markFailed(menu, in: context) }
            switch error {
            case TedmarksAPIError.server(_, let detail): message = detail ?? "The server couldn’t read the menu."
            default: message = "Couldn’t read the menu: \(error.localizedDescription)"
            }
        }
    }

    private var pending: [String: [String]] { defaults.dictionary(forKey: Self.pendingKey) as? [String: [String]] ?? [:] }

    private func setPending(_ menuId: UUID, _ pages: [String]?) {
        var all = pending
        all[menuId.uuidString.lowercased()] = pages
        defaults.set(all, forKey: Self.pendingKey)
    }

    /// Older menus kept their pages in Photos.
    private func retryFromPhotos(_ menu: PlaceMenu, place: Place, in context: ModelContext) async {
        let ids = menu.pagePhotoIds
        let photos = (try? context.fetch(FetchDescriptor<Photo>(predicate: #Predicate { ids.contains($0.id) }))) ?? []
        var sending: [TedmarksAPI.MenuReadPage] = []
        for id in ids {
            guard let photo = photos.first(where: { $0.id == id }),
                  let local = PhotoLibrary.localIdentifier(local: photo.localIdentifier, cloud: photo.cloudIdentifier),
                  let jpeg = await PhotoLibrary.jpeg(localIdentifier: local)
            else { continue }
            sending.append(.init(mediaType: "image/jpeg", data: jpeg))
        }
        guard !sending.isEmpty else {
            message = "The menu photos aren’t on this phone anymore. Add the pages again."
            try? MenuReading.markFailed(menu, in: context)
            return
        }
        await read(menu, newPages: nil, sending: sending, place: place, in: context)
    }
}

private func UTTypeFor(_ mediaType: String) -> UTType? { UTType(mimeType: mediaType) }
