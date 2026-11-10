import Foundation
import Testing
@testable import TedmarksKit

private func period(_ openDay: Int, _ open: String, _ closeDay: Int, _ close: String) -> OpeningPeriod {
    OpeningPeriod(open: .init(day: openDay, time: open), close: .init(day: closeDay, time: close))
}

/// Mon–Sat 11:30 AM – 10 PM.
private let lunchAndDinner = (1...6).map { period($0, "1130", $0, "2200") }

private func date(_ iso: String) -> Date { try! Date(iso, strategy: .iso8601) }

@Test func openForAMealUsesTheMealWindowOnThatDay() {
    #expect(OpeningHours.openForMeal(lunchAndDinner, day: 6, meal: .lunch) == true)
    #expect(OpeningHours.openForMeal(lunchAndDinner, day: 6, meal: .breakfast) == false)
    #expect(OpeningHours.openForMeal(lunchAndDinner, day: 0, meal: .dinner) == false)
    #expect(OpeningHours.openForMeal(nil, day: 1, meal: .lunch) == nil)
    let aroundTheClock = [OpeningPeriod(open: .init(day: 0, time: "0000"), close: nil)]
    #expect(OpeningHours.openForMeal(aroundTheClock, day: 3, meal: .breakfast) == true)
}

@Test func openNowIsInThePlacesOwnTime() {
    // Tue Nov 10, 2026: 20:00 UTC is 1 PM in Scottsdale (UTC−7); 05:00 UTC Wed is 10 PM Tue there.
    #expect(OpeningHours.isOpen(lunchAndDinner, utcOffsetMinutes: -420, at: date("2026-11-10T20:00:00Z")) == true)
    #expect(OpeningHours.isOpen(lunchAndDinner, utcOffsetMinutes: -420, at: date("2026-11-11T05:00:00Z")) == false)
    // Saturday night past midnight: Sat 6 PM – Sun 2 AM, at 1 AM Sunday.
    let late = [period(6, "1800", 0, "0200")]
    #expect(OpeningHours.isOpen(late, utcOffsetMinutes: 0, at: date("2026-11-15T01:00:00Z")) == true)
    #expect(OpeningHours.isOpen(late, utcOffsetMinutes: 0, at: date("2026-11-15T03:00:00Z")) == false)
    #expect(OpeningHours.isOpen([], utcOffsetMinutes: 0) == nil)
}

@Test func cuisineComesFromGooglesTypeUnlessItsGeneric() {
    #expect(MapFiltering.cuisineLabel(primaryType: "thai_restaurant", primaryTypeLabel: "Thai Restaurant") == "Thai")
    #expect(MapFiltering.cuisineLabel(primaryType: "restaurant", primaryTypeLabel: "Restaurant") == nil)
    #expect(MapFiltering.cuisineLabel(primaryType: "cafe", primaryTypeLabel: "Cafe") == "Cafe")
    #expect(MapFiltering.cuisineLabel(primaryType: nil, primaryTypeLabel: nil) == nil)
}

@Test func googlesRestaurantsMatchPriceRatingReviewsAndCuisine() {
    let taqueria = NearbyPlace(googlePlaceId: "t", name: "Taqueria", latitude: 33.5, longitude: -111.9,
                               primaryType: "mexican_restaurant", primaryTypeLabel: "Mexican Restaurant", distanceMeters: 0,
                               rating: 4.6, ratingsCount: 120, priceLevel: 1, openingHours: .init(periods: lunchAndDinner))
    var f = MapFilters()
    #expect(MapFiltering.matchesGoogle(taqueria, f))
    f.prices = [2, 3]
    #expect(!MapFiltering.matchesGoogle(taqueria, f))
    f.prices = [1]
    f.minGoogleRating = 4.5
    f.minReviews = 200
    #expect(!MapFiltering.matchesGoogle(taqueria, f))
    f.minReviews = 50
    f.cuisines = ["Italian", "Mexican"]
    #expect(MapFiltering.matchesGoogle(taqueria, f))
    f.when = .meal(day: 0, meal: .lunch)   // closed Sundays
    #expect(!MapFiltering.matchesGoogle(taqueria, f))
    // Unknown hours don't count as open.
    let noHours = NearbyPlace(googlePlaceId: "n", name: "N", latitude: 0, longitude: 0, distanceMeters: 0)
    #expect(!MapFiltering.matchesGoogle(noHours, MapFilters(json: #"{"when":{"now":{}}}"#)))
}

@Test func oursMatchVerdictTagsAndMealsSetByHand() {
    let wantToGo = Place(status: .wantToGo, name: "Want", latitude: 0, longitude: 0)
    wantToGo.tags = ["patio"]
    let been = Place(status: .beenThere, name: "Been", latitude: 0, longitude: 0)
    been.tags = ["date night"]
    var f = MapFilters()
    f.verdicts = [.wouldReturn]
    #expect(!MapFiltering.matchesOurs(wantToGo, verdict: .none, cuisine: nil, f))   // a verdict filter means been there
    #expect(MapFiltering.matchesOurs(been, verdict: .wouldReturn, cuisine: nil, f))
    #expect(!MapFiltering.matchesOurs(been, verdict: .disagree, cuisine: nil, f))
    f = MapFilters()
    f.tags = ["patio", "brunch"]
    #expect(MapFiltering.matchesOurs(wantToGo, verdict: .none, cuisine: nil, f))
    #expect(!MapFiltering.matchesOurs(been, verdict: .none, cuisine: nil, f))
    f = MapFilters()
    f.cuisines = [MapFilters.notSet]
    #expect(MapFiltering.matchesOurs(been, verdict: .none, cuisine: nil, f))
    #expect(!MapFiltering.matchesOurs(been, verdict: .none, cuisine: "Pizza", f))
    // Breakfast set by hand counts without hours; set to no, it doesn't even with them.
    f = MapFilters()
    f.when = .meal(day: 2, meal: .breakfast)
    been.servesBreakfast = true; been.servesLunch = true; been.servesDinner = false
    #expect(MapFiltering.matchesOurs(been, verdict: .none, cuisine: nil, f))
    f.when = .meal(day: 2, meal: .dinner)
    been.googleOpeningPeriods = lunchAndDinner
    #expect(!MapFiltering.matchesOurs(been, verdict: .none, cuisine: nil, f))
}

@Test func filtersAreRememberedAndOldOnesStillLoad() {
    var f = MapFilters()
    f.when = .meal(day: 6, meal: .breakfast)
    f.cuisines = ["Thai"]
    f.minReviews = 200
    #expect(MapFilters(json: f.json) == f)
    #expect(MapFilters(json: "{}") == MapFilters())
    #expect(MapFilters(json: "not json") == MapFilters())
    #expect(MapFilters(json: #"{"prices":[2],"somethingNew":true}"#).prices == [2])
    #expect(f.activeCount == 3)
    #expect(f.needsGoogleDetails)
    var oursOnly = MapFilters()
    oursOnly.verdicts = [.wouldReturn]
    oursOnly.tags = ["patio"]
    #expect(!oursOnly.needsGoogleDetails)
}

@Test func googleIsAskedForWhatItCanFilterItself() {
    var f = MapFilters()
    f.when = .meal(day: 6, meal: .breakfast)
    f.cuisines = ["Thai", MapFilters.notSet, "Peruvian"]
    f.prices = [1, 2]
    f.minGoogleRating = 4.5
    let request = f.googleRequest()
    #expect(request.query == "breakfast")
    #expect(request.openNow == nil)
    #expect(request.cuisineTypes == ["thai_restaurant", "peruvian_restaurant"])
    #expect(request.priceLevels == [1, 2])
    #expect(request.minRating == 4.5)
    f.when = .now
    #expect(f.googleRequest().openNow == true)
}

@Test func cuisineChoicesCountWhatsInViewThenTheCommonOnes() {
    let counts = MapFiltering.counts(["Pizza", nil, "Thai", "Pizza"])
    #expect(counts.map(\.value) == ["Pizza", "Thai", MapFilters.notSet])
    let choices = MapFiltering.withCommonCuisines(counts)
    #expect(choices.first?.count == 2)
    #expect(choices.contains { $0.value == "Mexican" && $0.count == 0 })
    #expect(choices.filter { $0.value == "Pizza" }.count == 1)
}

@Test func whenLabelsReadLikeTheWebsite() {
    #expect(MapFiltering.whenLabel(.any, today: 2) == "Any time")
    #expect(MapFiltering.whenLabel(.now, today: 2) == "Open now")
    #expect(MapFiltering.whenLabel(.meal(day: 2, meal: .lunch), today: 2) == "Today · lunch")
    #expect(MapFiltering.whenLabel(.meal(day: 3, meal: .dinner), today: 2) == "Tomorrow · dinner")
    #expect(MapFiltering.whenLabel(.meal(day: 6, meal: .breakfast), today: 2) == "Sat · breakfast")
}

@Test func syncReadsOpeningPeriods() {
    let value: JSONValue = .object(["open": .object(["day": .number(5), "time": .string("1700")]),
                                    "close": .object(["day": .number(6), "time": .string("0100")])])
    #expect(SyncValue.openingPeriod(value) == period(5, "1700", 6, "0100"))
    #expect(SyncValue.openingPeriod(.object(["open": .object(["day": .number(0), "time": .string("0000")])]))?.close == nil)
    #expect(SyncValue.openingPeriod(.string("nope")) == nil)
}
