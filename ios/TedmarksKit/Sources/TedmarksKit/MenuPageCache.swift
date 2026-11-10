import Foundation

/// Where menu pages go and come from (the server's /menu-pages).
public protocol MenuPageTransport: Sendable {
    func uploadMenuPage(id: UUID, data: Data, mediaType: String) async throws
    func downloadMenuPage(id: UUID) async throws -> Data
    func deleteMenuPage(id: UUID) async throws
}

extension TedmarksAPI: MenuPageTransport {}

/// Menu pages on this phone (Application Support/MenuPages/<id>): pages taken here wait to be
/// sent, and pages from the server are kept once opened (they never change, so they're never
/// fetched twice). Pages taken off a menu are deleted from the server once it can be reached.
@MainActor
public final class MenuPageCache {
    public static let shared = MenuPageCache()

    private let folder: URL
    private let defaults: UserDefaults
    private var flushing = false
    private static let uploadsKey = "menuPages.pendingUploads"
    private static let deletesKey = "menuPages.pendingDeletes"

    public init(folder: URL? = nil, defaults: UserDefaults = .standard) {
        self.folder = folder ?? URL.applicationSupportDirectory.appending(path: "MenuPages", directoryHint: .isDirectory)
        self.defaults = defaults
        try? FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
    }

    private func file(_ id: UUID) -> URL { folder.appending(path: id.uuidString.lowercased()) }

    /// A page on this phone, if it's here.
    public func cached(_ id: UUID) -> Data? { try? Data(contentsOf: file(id)) }

    public func isCached(_ id: UUID) -> Bool { FileManager.default.fileExists(atPath: file(id).path) }

    /// Keeps a page taken on this phone and queues it to be sent.
    public func add(_ data: Data, id: UUID, mediaType: String) throws {
        try data.write(to: file(id), options: .atomic)
        var uploads = pendingUploads
        uploads[id.uuidString.lowercased()] = mediaType
        defaults.set(uploads, forKey: Self.uploadsKey)
    }

    /// A page: from this phone, or fetched from the server and kept.
    public func data(for id: UUID, using transport: MenuPageTransport) async throws -> Data {
        if let data = cached(id) { return data }
        let data = try await transport.downloadMenuPage(id: id)
        try? data.write(to: file(id), options: .atomic)
        return data
    }

    /// Pages no menu uses any more: gone from this phone now, from the server when it can be reached.
    public func remove(_ ids: [UUID]) {
        guard !ids.isEmpty else { return }
        var uploads = pendingUploads
        var deletes = Set(defaults.stringArray(forKey: Self.deletesKey) ?? [])
        for id in ids {
            let key = id.uuidString.lowercased()
            try? FileManager.default.removeItem(at: file(id))
            // Never sent: nothing to delete on the server.
            if uploads.removeValue(forKey: key) == nil { deletes.insert(key) }
        }
        defaults.set(uploads, forKey: Self.uploadsKey)
        defaults.set(Array(deletes), forKey: Self.deletesKey)
    }

    /// Pages waiting to be sent.
    public var waitingToSend: Int { pendingUploads.count }

    private var pendingUploads: [String: String] { defaults.dictionary(forKey: Self.uploadsKey) as? [String: String] ?? [:] }

    /// Sends waiting pages and deletes removed ones; what fails is tried again next time.
    public func flush(using transport: MenuPageTransport) async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        for (key, mediaType) in pendingUploads {
            guard let id = UUID(uuidString: key) else { continue }
            guard let data = cached(id) else {
                forgetUpload(key)
                continue
            }
            do {
                try await transport.uploadMenuPage(id: id, data: data, mediaType: mediaType)
                forgetUpload(key)
            } catch {
                return   // offline: try the rest later
            }
        }
        for key in defaults.stringArray(forKey: Self.deletesKey) ?? [] {
            guard let id = UUID(uuidString: key) else { continue }
            do {
                try await transport.deleteMenuPage(id: id)
            } catch TedmarksAPIError.server(status: 404, _) {
                // already gone
            } catch {
                return
            }
            var deletes = defaults.stringArray(forKey: Self.deletesKey) ?? []
            deletes.removeAll { $0 == key }
            defaults.set(deletes, forKey: Self.deletesKey)
        }
    }

    private func forgetUpload(_ key: String) {
        var uploads = pendingUploads
        uploads.removeValue(forKey: key)
        defaults.set(uploads, forKey: Self.uploadsKey)
    }
}
