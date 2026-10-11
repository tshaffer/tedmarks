import Foundation

/// Links into Google Maps (the app when installed, otherwise the website — universal links).
enum GoogleMapsLink {
    /// Directions to a place: by name, and by Google id when known (which picks the exact place).
    static func directions(name: String, googlePlaceId: String?) -> URL {
        var components = URLComponents(string: "https://www.google.com/maps/dir/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: name),
        ] + (googlePlaceId.map { [URLQueryItem(name: "destination_place_id", value: $0)] } ?? [])
        return components.url!
    }
}
