import Foundation

/// A Google place suggested when starting a visit. Mirrors NearbyPlace in shared/src/api/places.ts.
public struct NearbyPlace: Codable, Hashable, Sendable, Identifiable {
    public var googlePlaceId: String
    public var name: String
    public var address: String?
    public var latitude: Double
    public var longitude: Double
    public var primaryType: String?
    public var primaryTypeLabel: String?
    public var distanceMeters: Double

    public var id: String { googlePlaceId }

    public init(
        googlePlaceId: String, name: String, address: String? = nil, latitude: Double, longitude: Double,
        primaryType: String? = nil, primaryTypeLabel: String? = nil, distanceMeters: Double
    ) {
        self.googlePlaceId = googlePlaceId
        self.name = name
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.primaryType = primaryType
        self.primaryTypeLabel = primaryTypeLabel
        self.distanceMeters = distanceMeters
    }
}

/// A type-ahead suggestion while searching. Mirrors PlaceSuggestion in shared/src/api/places.ts.
public struct PlaceSuggestion: Codable, Hashable, Sendable, Identifiable {
    public var googlePlaceId: String
    public var name: String
    public var secondaryText: String?
    public var distanceMeters: Double?

    public var id: String { googlePlaceId }

    public init(googlePlaceId: String, name: String, secondaryText: String? = nil, distanceMeters: Double? = nil) {
        self.googlePlaceId = googlePlaceId
        self.name = name
        self.secondaryText = secondaryText
        self.distanceMeters = distanceMeters
    }
}

public enum TedmarksAPIError: Error, Sendable {
    /// The server couldn't be reached (not running, wrong address, no network).
    case unreachable
    /// The server rejected the access key.
    case unauthorized
    /// The server answered with an error.
    case server(status: Int, message: String?)
    case badResponse
}

/// Minimal hand-written client for the endpoints the app uses so far.
/// (To be replaced by the client generated from shared/openapi.)
public struct TedmarksAPI: Sendable, SyncTransport {
    public let baseURL: URL
    private let accessKey: String?
    private let session: URLSession

    /// - Parameter accessKey: interim shared key sent as X-Tedmarks-Key (until Sign in with Apple).
    public init(baseURL: URL, accessKey: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.accessKey = accessKey
        self.session = session
    }

    /// Restaurants within `radiusMeters`, nearest first.
    public func nearbyPlaces(latitude: Double, longitude: Double, radiusMeters: Int) async throws -> [NearbyPlace] {
        try await getPlaces(path: "places/nearby", query: [
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lng", value: String(longitude)),
            URLQueryItem(name: "radius", value: String(radiusMeters)),
        ])
    }

    public func searchPlaces(_ text: String, latitude: Double, longitude: Double) async throws -> [NearbyPlace] {
        try await getPlaces(path: "places/search", query: [
            URLQueryItem(name: "q", value: text),
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lng", value: String(longitude)),
        ])
    }

    /// Type-ahead suggestions. Use one `sessionToken` for all keystrokes and the final
    /// `placeDetails` call so Google bills the whole search as one lookup.
    public func autocomplete(
        _ text: String, latitude: Double, longitude: Double, sessionToken: UUID
    ) async throws -> [PlaceSuggestion] {
        let data = try await get(path: "places/autocomplete", query: [
            URLQueryItem(name: "q", value: text),
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lng", value: String(longitude)),
            URLQueryItem(name: "sessionToken", value: sessionToken.uuidString),
        ])
        return try decode(SuggestionsResponse.self, from: data).suggestions
    }

    /// The place picked from autocomplete.
    public func placeDetails(
        googlePlaceId: String, latitude: Double, longitude: Double, sessionToken: UUID?
    ) async throws -> NearbyPlace {
        var query = [
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lng", value: String(longitude)),
        ]
        if let sessionToken { query.append(URLQueryItem(name: "sessionToken", value: sessionToken.uuidString)) }
        let data = try await get(path: "places/details/\(googlePlaceId)", query: query)
        return try decode(DetailsResponse.self, from: data).place
    }

    public struct MorePlaces: Decodable, Sendable {
        public var places: [NearbyPlace]
        /// Absent when Google has no more results.
        public var nextPageToken: String?
    }

    /// "Show more": the next batch of nearby restaurants, excluding ones already shown.
    public func morePlaces(
        latitude: Double, longitude: Double, radiusMeters: Int, excluding shownIds: [String], pageToken: String?
    ) async throws -> MorePlaces {
        struct Body: Encodable {
            var lat: Double, lng: Double, radiusMeters: Int, excludeIds: [String], pageToken: String?
        }
        let body = Body(lat: latitude, lng: longitude, radiusMeters: radiusMeters, excludeIds: shownIds, pageToken: pageToken)
        let data = try await send(path: "places/more", method: "POST", query: [], body: try JSONEncoder().encode(body))
        return try decode(MorePlaces.self, from: data)
    }

    // MARK: - Voice notes

    /// Claude's proposed changes for a voice-note transcript (never applied without confirmation).
    public func structureVoice(_ request: VoiceStructureRequest) async throws -> [VoiceChange] {
        struct Response: Decodable { var changes: [VoiceChange] }
        let data = try await send(path: "ai/voice", method: "POST", query: [], body: try JSONEncoder().encode(request))
        return try decode(Response.self, from: data).changes
    }

    /// Asks the server to re-fetch a saved place's Google details (hours, website, phone,
    /// rating); they arrive on the next sync.
    public func refreshPlace(id: UUID) async throws {
        _ = try await send(path: "places/\(id.uuidString.lowercased())/refresh", method: "POST", query: [], body: nil)
    }

    // MARK: - Menus

    /// Claude reads dishes from menu pages (JPEG data, in order). Pages aren't kept on the server.
    public func readMenu(placeName: String, pages: [Data]) async throws -> [MenuItem] {
        struct Page: Encodable { var mediaType = "image/jpeg"; var data: String }
        struct Body: Encodable { var placeName: String; var pages: [Page] }
        struct Response: Decodable { var items: [MenuItem] }
        let body = Body(placeName: placeName, pages: pages.map { Page(data: $0.base64EncodedString()) })
        let data = try await send(path: "ai/menu", method: "POST", query: [], body: try JSONEncoder().encode(body))
        return try decode(Response.self, from: data).items
    }

    // MARK: - Sync

    public func syncPush(_ changes: [String: [SyncRecord]]) async throws -> SyncPushResult {
        let body = try JSONEncoder().encode(["changes": changes])
        return try decode(SyncPushResult.self, from: try await send(path: "sync/push", method: "POST", query: [], body: body))
    }

    public func syncPull(since: Int, limit: Int) async throws -> SyncPullResult {
        let data = try await get(path: "sync/pull", query: [
            URLQueryItem(name: "since", value: String(since)),
            URLQueryItem(name: "limit", value: String(limit)),
        ])
        return try decode(SyncPullResult.self, from: data)
    }

    private struct PlacesResponse: Decodable { var places: [NearbyPlace] }
    private struct SuggestionsResponse: Decodable { var suggestions: [PlaceSuggestion] }
    private struct DetailsResponse: Decodable { var place: NearbyPlace }
    private struct ErrorResponse: Decodable { var message: String? }

    private func getPlaces(path: String, query: [URLQueryItem]) async throws -> [NearbyPlace] {
        try decode(PlacesResponse.self, from: try await get(path: path, query: query)).places
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw TedmarksAPIError.badResponse
        }
    }

    private func get(path: String, query: [URLQueryItem]) async throws -> Data {
        try await send(path: path, method: "GET", query: query, body: nil)
    }

    private func send(path: String, method: String, query: [URLQueryItem], body: Data?) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.timeoutInterval = path == "ai/menu" ? 180 : path.hasPrefix("ai/") ? 60 : 20
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let accessKey { request.setValue(accessKey, forHTTPHeaderField: "X-Tedmarks-Key") }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TedmarksAPIError.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw TedmarksAPIError.badResponse }
        if http.statusCode == 401 { throw TedmarksAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = try? JSONDecoder().decode(ErrorResponse.self, from: data).message
            throw TedmarksAPIError.server(status: http.statusCode, message: message)
        }
        return data
    }
}
