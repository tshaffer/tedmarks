import Foundation
import Observation
import SwiftData
import TedmarksKit

/// Snap the menu → pages saved to Photos (Tedmarks album) → Claude reads the dishes in the
/// background → they become "On the menu" choices. Shared so reading continues after the
/// screen that started it closes.
@MainActor
@Observable
final class MenuCapture {
    static let shared = MenuCapture()

    /// Menus being read right now.
    private(set) var reading: Set<UUID> = []
    var message: String?

    /// New pages from the menu camera (JPEG, in order).
    func capture(pages jpegs: [Data], place: Place, visit: Visit?, in context: ModelContext) async {
        guard !jpegs.isEmpty else { return }
        var photos: [Photo] = []
        if await PhotoLibrary.requestAccess(), let saved = try? await PhotoLibrary.save(jpegs) {
            photos = makePhotos(saved, place: place, visit: visit, in: context)
        }
        await start(pages: jpegs, photos: photos, place: place, visit: visit, in: context)
    }

    /// Menu photos already in the library (e.g. taken earlier with the Camera app).
    func useExisting(localIdentifiers: [String], place: Place, visit: Visit?, in context: ModelContext) async {
        var jpegs: [Data] = []
        var saved: [PhotoLibrary.SavedAsset] = []
        let cloud = PhotoLibrary.cloudIdentifiers(for: localIdentifiers)
        for id in localIdentifiers {
            guard let jpeg = await PhotoLibrary.jpeg(localIdentifier: id) else { continue }
            jpegs.append(jpeg)
            saved.append(.init(localIdentifier: id, cloudIdentifier: cloud[id], pixelWidth: 0, pixelHeight: 0))
        }
        guard !jpegs.isEmpty else {
            message = "Couldn't open those photos."
            return
        }
        await start(pages: jpegs, photos: makePhotos(saved, place: place, visit: visit, in: context), place: place, visit: visit, in: context)
    }

    /// Reads a menu again from its photos (after a failed or offline try).
    func retry(_ menu: PlaceMenu, place: Place, in context: ModelContext) async {
        let ids = menu.pagePhotoIds
        let photos = (try? context.fetch(FetchDescriptor<Photo>(predicate: #Predicate { ids.contains($0.id) }))) ?? []
        var jpegs: [Data] = []
        for id in ids {
            guard let photo = photos.first(where: { $0.id == id }),
                  let local = PhotoLibrary.localIdentifier(local: photo.localIdentifier, cloud: photo.cloudIdentifier),
                  let jpeg = await PhotoLibrary.jpeg(localIdentifier: local)
            else { continue }
            jpegs.append(jpeg)
        }
        guard !jpegs.isEmpty else {
            message = "The menu photos aren't on this phone anymore. Snap the menu again."
            try? MenuReading.markFailed(menu, in: context)
            return
        }
        await read(menu, pages: jpegs, placeName: place.name, in: context)
    }

    #if DEBUG
    /// Dev/testing: reads image files as a menu without the camera or Photos (`-menuImage <path>`).
    func debugRead(files: [String], place: Place, visit: Visit?, in context: ModelContext) async {
        let jpegs = files.compactMap { FileManager.default.contents(atPath: $0) }
        await start(pages: jpegs, photos: [], place: place, visit: visit, in: context)
    }
    #endif

    // MARK: - Private

    private func makePhotos(_ saved: [PhotoLibrary.SavedAsset], place: Place, visit: Visit?, in context: ModelContext) -> [Photo] {
        let me = (try? VisitStarter.devicePerson(in: context))?.map(\.id) ?? Household.tedId
        return saved.map { asset in
            let photo = Photo(placeId: place.id, role: .menuPage, localIdentifier: asset.localIdentifier,
                              cloudIdentifier: asset.cloudIdentifier, capturedAt: .now, capturedBy: me)
            photo.visitId = visit?.id
            if asset.pixelWidth > 0 {
                photo.pixelWidth = asset.pixelWidth
                photo.pixelHeight = asset.pixelHeight
            }
            context.insert(photo)
            return photo
        }
    }

    private func start(pages jpegs: [Data], photos: [Photo], place: Place, visit: Visit?, in context: ModelContext) async {
        do {
            let menu = try MenuReading.startMenu(place: place, visit: visit, pages: photos, in: context)
            await read(menu, pages: jpegs, placeName: place.name, in: context)
        } catch {
            message = error.localizedDescription
        }
    }

    private func read(_ menu: PlaceMenu, pages jpegs: [Data], placeName: String, in context: ModelContext) async {
        reading.insert(menu.id)
        defer { reading.remove(menu.id) }
        do {
            let items = try await AppConfig.api.readMenu(placeName: placeName, pages: jpegs)
            try MenuReading.apply(items, to: menu, in: context)
            if items.isEmpty { message = "Claude didn't find any dishes in those photos." }
        } catch {
            // With the pages in Photos it can be read later; without them it can't.
            if menu.pagePhotoIds.isEmpty { try? MenuReading.markFailed(menu, in: context) }
            switch error {
            case TedmarksAPIError.unreachable: message = "Couldn't reach the server to read the menu. Try again when you're online."
            case TedmarksAPIError.server(_, let detail): message = detail ?? "The server couldn't read the menu."
            default: message = "Couldn't read the menu: \(error.localizedDescription)"
            }
        }
    }
}
