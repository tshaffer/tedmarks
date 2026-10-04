import Foundation

/// How saved places rank among nearby Google results when starting a visit.
/// Saved places get a head start so a want-to-go place a little farther away is
/// still offered first; otherwise nearest first.
public enum PlaceRanking {
    public static let wantToGoBonusMeters: Double = 120
    public static let beenThereBonusMeters: Double = 80

    public static func rank(_ places: [NearbyPlace], savedStatus: (NearbyPlace) -> PlaceStatus?) -> [NearbyPlace] {
        func score(_ place: NearbyPlace) -> Double {
            switch savedStatus(place) {
            case .wantToGo: place.distanceMeters - wantToGoBonusMeters
            case .beenThere: place.distanceMeters - beenThereBonusMeters
            case nil: place.distanceMeters
            }
        }
        return places.enumerated()
            .sorted { lhs, rhs in
                let (a, b) = (score(lhs.element), score(rhs.element))
                return a == b ? lhs.offset < rhs.offset : a < b
            }
            .map(\.element)
    }
}
