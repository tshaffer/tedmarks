import Foundation

/// Something on the phone's map: what Google found (and ours if it's saved), or one of ours it didn't.
public struct MapPlace {
    public let place: NearbyPlace
    public let saved: Place?
}

/// What the map has in view.
public struct MapBounds: Equatable, Sendable {
    public let south: Double, west: Double, north: Double, east: Double

    public init(south: Double, west: Double, north: Double, east: Double) {
        self.south = south
        self.west = west
        self.north = north
        self.east = east
    }

    public func contains(latitude: Double, longitude: Double) -> Bool {
        (south...north).contains(latitude) && (west...east).contains(longitude)
    }
}

@MainActor
public enum MapPlaces {
    /// How near you must be to start a visit from the map; farther away you're planning.
    public static let startVisitReachMeters: Double = 5_000

    /// A saved place's id on the map: Google's, or ours for one with no Google place.
    public static func pinId(for place: Place) -> String {
        place.googlePlaceId ?? place.id.uuidString
    }

    /// What Google found, then every saved place it didn't. Places with no location are left out.
    public static func merged(
        found: [NearbyPlace], saved: [Place], from origin: (latitude: Double, longitude: Double)?
    ) -> [MapPlace] {
        var savedByGoogleId: [String: Place] = [:]
        for place in saved {
            if let id = place.googlePlaceId, savedByGoogleId[id] == nil { savedByGoogleId[id] = place }
        }
        var seen = Set<String>()
        var result: [MapPlace] = []
        for place in found where seen.insert(place.googlePlaceId).inserted {
            result.append(MapPlace(place: place, saved: savedByGoogleId[place.googlePlaceId]))
        }
        for place in saved where seen.insert(pinId(for: place)).inserted && (place.latitude != 0 || place.longitude != 0) {
            result.append(MapPlace(place: NearbyPlace(
                googlePlaceId: pinId(for: place),
                name: place.name,
                address: place.googleAddress,
                latitude: place.latitude,
                longitude: place.longitude,
                primaryType: place.googlePrimaryType,
                primaryTypeLabel: place.googlePrimaryTypeLabel,
                distanceMeters: origin.map { PlaceInsights.distanceMeters(to: place, from: $0) } ?? 0
            ), saved: place))
        }
        return result
    }

    public static func isWithinReach(_ place: NearbyPlace, of origin: (latitude: Double, longitude: Double)) -> Bool {
        PlaceInsights.distanceMeters(latitude: place.latitude, longitude: place.longitude, from: origin) <= startVisitReachMeters
    }
}
