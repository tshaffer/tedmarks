import Foundation
import Observation
import SwiftData

/// Talks to the server for sync. Implemented by TedmarksAPI; a fake in tests.
public protocol SyncTransport: Sendable {
    func syncPush(_ changes: [String: [SyncRecord]]) async throws -> SyncPushResult
    func syncPull(since: Int, limit: Int) async throws -> SyncPullResult
}

public struct SyncPushResult: Decodable, Sendable {
    public struct Accepted: Decodable, Sendable { public var collection: String; public var id: String; public var serverSeq: Int }
    public struct Rejected: Decodable, Sendable { public var collection: String; public var id: String; public var reason: String }
    public var accepted: [Accepted]
    public var newer: [String: [SyncRecord]]
    public var rejected: [Rejected]

    public init(accepted: [Accepted] = [], newer: [String: [SyncRecord]] = [:], rejected: [Rejected] = []) {
        self.accepted = accepted
        self.newer = newer
        self.rejected = rejected
    }
}

public struct SyncPullResult: Decodable, Sendable {
    public var changes: [String: [SyncRecord]]
    public var serverSeq: Int
    public var hasMore: Bool

    public init(changes: [String: [SyncRecord]], serverSeq: Int, hasMore: Bool) {
        self.changes = changes
        self.serverSeq = serverSeq
        self.hasMore = hasMore
    }
}

/// Keeps this phone and the server in step: pushes every local change (found by comparing each
/// record with what was last synced), then pulls everything the server has that's newer.
/// Latest modifiedAt wins per record, on both sides.
@MainActor
@Observable
public final class SyncEngine {
    public static let shared = SyncEngine()

    public private(set) var isSyncing = false
    public private(set) var lastSyncedAt: Date?
    public private(set) var lastError: String?
    /// Records the server refused (shown in Settings); they're retried on every sync.
    public private(set) var rejected: [SyncPushResult.Rejected] = []

    private var transport: SyncTransport?
    private var context: ModelContext?
    private var scheduled: Task<Void, Never>?
    private var syncAgain = false
    private let defaults: UserDefaults
    private static let cursorKey = "sync.serverSeq"
    private static let lastSyncedKey = "sync.lastSyncedAt"
    private static let pushBatchSize = 200

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        lastSyncedAt = defaults.object(forKey: Self.lastSyncedKey) as? Date
    }

    /// Call once at launch. Until then (e.g. in the widget extension) sync does nothing.
    public func configure(transport: SyncTransport, context: ModelContext) {
        self.transport = transport
        self.context = context
    }

    /// Sync a few seconds from now; repeated calls (one per tap) collapse into one sync.
    public func scheduleSync(after delay: Duration = .seconds(3)) {
        guard transport != nil else { return }
        scheduled?.cancel()
        scheduled = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    /// Push, then pull. Safe to call any time; a call during a sync runs once it finishes.
    public func sync() async {
        guard let transport, let context else { return }
        guard !isSyncing else {
            syncAgain = true
            return
        }
        isSyncing = true
        defer { isSyncing = false }
        repeat {
            syncAgain = false
            do {
                try await push(transport: transport, context: context)
                try await pull(transport: transport, context: context)
                lastSyncedAt = .now
                defaults.set(lastSyncedAt, forKey: Self.lastSyncedKey)
                lastError = nil
            } catch {
                lastError = Self.describe(error)
                return
            }
        } while syncAgain
    }

    // MARK: - Push

    private func push(transport: SyncTransport, context: ModelContext) async throws {
        let local = try LocalRecords(context: context)
        let states = try syncStates(context)
        let now = Date.now

        // Find local changes. A record changed without a newer modifiedAt gets one now,
        // so it wins over the server's copy.
        var outgoing: [(collection: SyncCollection, id: UUID, record: SyncRecord, hash: String)] = []
        for collection in SyncCollection.allCases {
            for entry in local.encoded(collection) {
                let key = Self.key(collection, entry.id)
                var record = entry.record
                var hash = SyncValue.hash(record)
                guard let state = states[key] else {
                    outgoing.append((collection, entry.id, record, hash))
                    continue
                }
                guard state.recordHash != hash else { continue }
                if entry.modifiedAt <= state.modifiedAt {
                    entry.touch(now)
                    record["modifiedAt"] = SyncValue.date(now)
                    hash = SyncValue.hash(record)
                }
                outgoing.append((collection, entry.id, record, hash))
            }
        }
        if context.hasChanges { try context.save() }

        var rejected: [SyncPushResult.Rejected] = []
        var newer: [String: [SyncRecord]] = [:]
        for start in stride(from: 0, to: outgoing.count, by: Self.pushBatchSize) {
            let batch = outgoing[start..<min(start + Self.pushBatchSize, outgoing.count)]
            var changes: [String: [SyncRecord]] = [:]
            for entry in batch { changes[entry.collection.rawValue, default: []].append(entry.record) }

            let result = try await transport.syncPush(changes)

            let sent = Dictionary(batch.map { (Self.key($0.collection, $0.id), $0) }) { first, _ in first }
            for accepted in result.accepted {
                guard let collection = SyncCollection(rawValue: accepted.collection),
                      let id = UUID(uuidString: accepted.id),
                      let entry = sent[Self.key(collection, id)]
                else { continue }
                remember(entry.record, hash: entry.hash, key: Self.key(collection, id), states: states, context: context)
            }
            rejected += result.rejected
            newer.merge(result.newer) { $0 + $1 }
        }
        self.rejected = rejected
        if !newer.isEmpty { try apply(newer, context: context) }
        try context.save()
    }

    // MARK: - Pull

    private func pull(transport: SyncTransport, context: ModelContext) async throws {
        var since = defaults.integer(forKey: Self.cursorKey)
        // Collect every page first, so a record never arrives before the place or visit it belongs to.
        var changes: [String: [SyncRecord]] = [:]
        while true {
            let page = try await transport.syncPull(since: since, limit: 500)
            changes.merge(page.changes) { $0 + $1 }
            since = page.serverSeq
            if !page.hasMore { break }
        }
        if !changes.isEmpty {
            try apply(changes, context: context)
            try context.save()
        }
        defaults.set(since, forKey: Self.cursorKey)
    }

    /// Applies server records, oldest first, unless this phone has a newer unsynced change.
    private func apply(_ changes: [String: [SyncRecord]], context: ModelContext) throws {
        var local = try LocalRecords(context: context)
        let states = try syncStates(context)
        for collection in SyncCollection.allCases {
            for record in changes[collection.rawValue] ?? [] {
                guard let id = SyncValue.parseId(record["id"]) else { continue }
                let key = Self.key(collection, id)
                if let mine = local.encoded(collection, id: id),
                   SyncValue.hash(mine) != states[key]?.recordHash,
                   let localModified = local.modifiedAt(collection, id: id),
                   let incomingModified = SyncValue.parseDate(record["modifiedAt"]),
                   localModified > incomingModified {
                    continue   // our unsynced change is newer; it goes up on the next push
                }
                guard SyncDecoder.apply(record, to: collection, local: &local, context: context),
                      let applied = local.encoded(collection, id: id)
                else { continue }
                remember(applied, hash: SyncValue.hash(applied), key: key, states: states, context: context)
            }
        }
    }

    // MARK: - Bookkeeping

    private func syncStates(_ context: ModelContext) throws -> [String: SyncRecordState] {
        Dictionary(try context.fetch(FetchDescriptor<SyncRecordState>()).map { ($0.recordKey, $0) }) { first, _ in first }
    }

    private func remember(_ record: SyncRecord, hash: String, key: String, states: [String: SyncRecordState], context: ModelContext) {
        let modifiedAt = SyncValue.parseDate(record["modifiedAt"]) ?? .now
        if let state = states[key] ?? (try? context.fetch(FetchDescriptor<SyncRecordState>(predicate: #Predicate { $0.recordKey == key })).first) {
            state.recordHash = hash
            state.modifiedAt = modifiedAt
        } else {
            context.insert(SyncRecordState(recordKey: key, recordHash: hash, modifiedAt: modifiedAt))
        }
    }

    private static func key(_ collection: SyncCollection, _ id: UUID) -> String {
        "\(collection.rawValue)/\(id.uuidString.lowercased())"
    }

    private static func describe(_ error: Error) -> String {
        switch error as? TedmarksAPIError {
        case .unreachable: "Can't reach the Tedmarks server."
        case .unauthorized: "The server didn't accept this app's access key."
        case .server(_, let message): message ?? "The server couldn't sync."
        case .badResponse: "The server sent something unexpected."
        case nil: error.localizedDescription
        }
    }
}
