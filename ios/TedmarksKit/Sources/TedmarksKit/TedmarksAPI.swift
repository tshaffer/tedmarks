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
    /// The server answered with an error.
    case server(status: Int, message: String?)
    case badResponse
}

/// Minimal hand-written client for the endpoints the app uses so far.
/// (To be replaced by the client generated from shared/openapi.)
public struct TedmarksAPI: Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Nearby restaurants. The server starts at `radiusMeters` and widens (×5 steps)
    /// up to `maxRadiusMeters` until something is found.
    public func nearbyPlaces(
        latitude: Double, longitude: Double, radiusMeters: Int, maxRadiusMeters: Int
    ) async throws -> [NearbyPlace] {
        try await getPlaces(path: "places/nearby", query: [
            URLQueryItem(name: "lat", value: String(latitude)),
            URLQueryItem(name: "lng", value: String(longitude)),
            URLQueryItem(name: "radius", value: String(radiusMeters)),
            URLQueryItem(name: "maxRadius", value: String(max(maxRadiusMeters, radiusMeters))),
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
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw TedmarksAPIError.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw TedmarksAPIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = try? JSONDecoder().decode(ErrorResponse.self, from: data).message
            throw TedmarksAPIError.server(status: http.statusCode, message: message)
        }
        return data
    }
}
