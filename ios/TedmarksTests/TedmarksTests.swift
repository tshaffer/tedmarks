import Testing
import TedmarksKit

@Test func appCanUseTedmarksKitRules() {
    let display = displayRating(
        [RatingInput(scope: .joint, value: ItemRatingValue.loved)],
        household: ["ted", "lori"]
    )
    #expect(display == .joint(.loved))
}
