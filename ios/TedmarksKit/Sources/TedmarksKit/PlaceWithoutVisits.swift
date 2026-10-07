import Foundation

/// What happens to a "been there" place left with no visits (its only visit was deleted or discarded).
public enum PlaceWithoutVisitsAction: String, Sendable, Decodable {
    case keep, wantToGo, delete
}

/// - a review or our own rating        → stays been there (we went; the visits just weren't recorded)
/// - we want to go (interest)          → becomes want to go
/// - a menu or a note about the place  → becomes want to go (keeps what we saved)
/// - nothing else                      → deleted (it only existed for that visit)
///
/// Mirrors shared/src/rules/placeWithoutVisits.ts; both are tested against
/// shared/fixtures/place-without-visits-cases.json.
public func placeWithoutVisits(status: PlaceStatus, hasInterest: Bool, hasReview: Bool, hasMenuOrNotes: Bool) -> PlaceWithoutVisitsAction {
    guard status == .beenThere else { return .keep }
    if hasReview { return .keep }
    if hasInterest { return .wantToGo }
    if hasMenuOrNotes { return .wantToGo }
    return .delete
}
