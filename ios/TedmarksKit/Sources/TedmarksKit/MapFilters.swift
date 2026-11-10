import Foundation

// The map's filters, as on the website (web/src/home/filters.ts): When · Cuisine · Price · Our
// verdict · Tags, and Google's rating and reviews. Choices within a filter are OR (Mexican or
// Italian); different filters are AND. Some apply to every restaurant, some only to ours, some
// only to Google's. (Been there / Want to go / Google are the map's own toggles.)

/// Google's weekly opening period. Days: 0 = Sunday; times "HHMM". Mirrors OpeningPeriod in shared/src/schema/place.ts.
public struct OpeningPeriod: Codable, Hashable, Sendable {
    public struct Point: Codable, Hashable, Sendable {
        public var day: Int
        public var time: String
        public init(day: Int, time: String) {
            self.day = day
            self.time = time
        }
    }

    public var open: Point
    public var close: Point?

    public init(open: Point, close: Point?) {
        self.open = open
        self.close = close
    }
}

public enum Meal: String, Codable, CaseIterable, Sendable {
    case breakfast, lunch, dinner

    public var label: String { rawValue.capitalized }
}

/// The meals a place serves, set by hand (attributes.mealsServed).
public struct MealsServed: Codable, Hashable, Sendable {
    public var breakfast: Bool
    public var lunch: Bool
    public var dinner: Bool

    public init(breakfast: Bool, lunch: Bool, dinner: Bool) {
        self.breakfast = breakfast
        self.lunch = lunch
        self.dinner = dinner
    }

    public func serves(_ meal: Meal) -> Bool {
        switch meal {
        case .breakfast: breakfast
        case .lunch: lunch
        case .dinner: dinner
        }
    }
}

/// Open now and open for a meal, from Google's periods (shared/src/rules/hours.ts and meals.ts).
public enum OpeningHours {
    private static let week = 7 * 1440

    /// The windows a place has to be open in to count as serving a meal.
    static func window(_ meal: Meal) -> (Int, Int) {
        switch meal {
        case .breakfast: (7 * 60, 10 * 60 + 30)
        case .lunch: (11 * 60 + 30, 14 * 60)
        case .dinner: (17 * 60 + 30, 21 * 60)
        }
    }

    private static func clockMinutes(_ time: String) -> Int {
        let digits = Array(time)
        guard digits.count >= 4, let h = Int(String(digits[0...1])), let m = Int(String(digits[2...3])) else { return 0 }
        return h * 60 + m
    }

    private static func isAroundTheClock(_ periods: [OpeningPeriod]) -> Bool {
        periods.count == 1 && periods[0].close == nil && periods[0].open.time == "0000"
    }

    /// Each period as [start, end) minutes of the week (ends past the week wrap).
    private static func ranges(_ periods: [OpeningPeriod]) -> [(Int, Int)] {
        periods.map { p in
            let start = p.open.day * 1440 + clockMinutes(p.open.time)
            var end = p.close.map { $0.day * 1440 + clockMinutes($0.time) } ?? start + 1440
            if end <= start { end += week }
            return (start, end)
        }
    }

    /// Whether it's open at `now`, in the place's own time (`utcOffsetMinutes` from Google; else
    /// `timeZone`). Nil without hours.
    public static func isOpen(_ periods: [OpeningPeriod]?, utcOffsetMinutes: Int?, at now: Date = .now, timeZone: TimeZone = .current) -> Bool? {
        guard let periods, !periods.isEmpty else { return nil }
        if isAroundTheClock(periods) { return true }
        let offset = utcOffsetMinutes ?? timeZone.secondsFromGMT(for: now) / 60
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let local = utc.dateComponents([.weekday, .hour, .minute], from: now.addingTimeInterval(Double(offset) * 60))
        let t = ((local.weekday ?? 1) - 1) * 1440 + (local.hour ?? 0) * 60 + (local.minute ?? 0)
        return ranges(periods).contains { start, end in
            (t >= start && t < end) || (t >= start - week && t < end - week)
        }
    }

    /// Whether it's open at some point during a meal's window on `day` (0 = Sunday). Nil without hours.
    public static func openForMeal(_ periods: [OpeningPeriod]?, day: Int, meal: Meal) -> Bool? {
        guard let periods, !periods.isEmpty else { return nil }
        if isAroundTheClock(periods) { return true }
        let (from, to) = window(meal)
        let start = day * 1440 + from, end = day * 1440 + to
        return ranges(periods).contains { open, close in
            [0, -week].contains { shift in open + shift < end && close + shift > start }
        }
    }
}

/// When we want to eat: any time, right now, or a day's meal (planning a trip). Days: 0 = Sunday.
public enum MapWhen: Codable, Hashable, Sendable {
    case any
    case now
    case meal(day: Int, meal: Meal)
}

/// "Our verdict" choices.
public enum VerdictChoice: String, Codable, CaseIterable, Sendable {
    case wouldReturn, tryAgain, wontReturn, disagree, none

    public var label: String {
        switch self {
        case .wouldReturn: "👍 Would return"
        case .tryAgain: "👌 Try again"
        case .wontReturn: "👎 Won’t return"
        case .disagree: "↔ We disagree"
        case .none: "No verdict yet"
        }
    }

    public init(_ verdict: RatingDisplay<VerdictValue>) {
        switch verdict {
        case .joint(let value):
            self = switch value {
            case .wouldReturn: .wouldReturn
            case .tryAgain: .tryAgain
            case .wontReturn: .wontReturn
            }
        case .split: self = .disagree
        case .none: self = .none
        }
    }
}

/// What Google can narrow itself (POST /places/area-search); the rest is applied to what comes back.
public struct AreaSearchFilters: Codable, Hashable, Sendable {
    public var query: String?
    public var cuisineTypes: [String]?
    public var minRating: Double?
    public var priceLevels: [Int]?
    public var openNow: Bool?
}

public struct MapFilters: Codable, Hashable, Sendable {
    public var when: MapWhen = .any
    /// Cuisines ("Pizza", "Thai"; `MapFilters.notSet` for places without one); empty = any.
    public var cuisines: [String] = []
    /// 1–4 ($–$$$$); empty = any.
    public var prices: [Int] = []
    public var verdicts: [VerdictChoice] = []
    /// Any of these tags; empty = any.
    public var tags: [String] = []
    public var minGoogleRating: Double?
    public var minReviews: Int?

    /// The cuisine choice for places whose type is unknown or generic.
    public static let notSet = ""

    public init() {}

    // Each field is optional when decoding, so filters saved by an older build still load.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        when = (try? c.decodeIfPresent(MapWhen.self, forKey: .when)) ?? .any
        cuisines = (try? c.decodeIfPresent([String].self, forKey: .cuisines)) ?? []
        prices = (try? c.decodeIfPresent([Int].self, forKey: .prices)) ?? []
        verdicts = (try? c.decodeIfPresent([VerdictChoice].self, forKey: .verdicts)) ?? []
        tags = (try? c.decodeIfPresent([String].self, forKey: .tags)) ?? []
        minGoogleRating = try? c.decodeIfPresent(Double.self, forKey: .minGoogleRating)
        minReviews = try? c.decodeIfPresent(Int.self, forKey: .minReviews)
    }

    /// How many filters are on.
    public var activeCount: Int {
        [when != .any, !cuisines.isEmpty, !prices.isEmpty, !verdicts.isEmpty, !tags.isEmpty, minGoogleRating != nil, minReviews != nil]
            .filter { $0 }.count
    }

    /// Google's restaurants need their details (hours, price, rating) to be filtered: ask the
    /// area search instead of the plain nearby list.
    public var needsGoogleDetails: Bool {
        when != .any || !cuisines.isEmpty || !prices.isEmpty || minGoogleRating != nil || minReviews != nil
    }

    /// Saved as JSON in the app's settings.
    public var json: String {
        (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    public init(json: String) {
        self = json.data(using: .utf8).flatMap { try? JSONDecoder().decode(MapFilters.self, from: $0) } ?? MapFilters()
    }

    /// What to ask Google for.
    public func googleRequest() -> AreaSearchFilters {
        let types = cuisines.filter { $0 != Self.notSet }.map(MapFiltering.googleType(forCuisine:)).prefix(4)
        var request = AreaSearchFilters()
        if case .meal(_, let meal) = when { request.query = meal.rawValue }
        if when == .now { request.openNow = true }
        if !types.isEmpty { request.cuisineTypes = Array(types) }
        request.minRating = minGoogleRating
        if !prices.isEmpty { request.priceLevels = prices }
        return request
    }
}

public enum MapFiltering {
    /// Google types that say nothing about the food.
    static let genericTypes: Set<String> = ["restaurant", "food", "meal_takeaway", "meal_delivery", "establishment", "point_of_interest", "store", "food_store"]

    /// Google's type as a cuisine: "Thai Restaurant" → "Thai"; nil when it's generic.
    public static func cuisineLabel(primaryType: String?, primaryTypeLabel: String?) -> String? {
        guard let label = primaryTypeLabel, !label.isEmpty,
              !(primaryType.map(genericTypes.contains) ?? false),
              label.range(of: #"^restaurant$"#, options: [.regularExpression, .caseInsensitive]) == nil
        else { return nil }
        let trimmed = label.replacingOccurrences(of: #"\s+Restaurant$"#, with: "", options: [.regularExpression, .caseInsensitive])
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Our place's cuisine: our type ("Pizza"), else Google's.
    public static func cuisine(of place: Place, subtypeName: String?) -> String? {
        if let ours = subtypeName, ours.range(of: #"^restaurants?$"#, options: [.regularExpression, .caseInsensitive]) == nil {
            return ours
        }
        return cuisineLabel(primaryType: place.googlePrimaryType, primaryTypeLabel: place.googlePrimaryTypeLabel)
    }

    /// Open at the chosen time (unknown hours count as no, except a meal set by hand).
    static func openWhen(_ when: MapWhen, periods: [OpeningPeriod]?, utcOffsetMinutes: Int?, mealsByHand: MealsServed? = nil, now: Date) -> Bool {
        switch when {
        case .any: return true
        case .now: return OpeningHours.isOpen(periods, utcOffsetMinutes: utcOffsetMinutes, at: now) ?? false
        case .meal(let day, let meal):
            let byHand = mealsByHand?.serves(meal)
            if byHand == false { return false }
            return OpeningHours.openForMeal(periods, day: day, meal: meal) ?? (byHand == true)
        }
    }

    public static func matchesCuisine(_ cuisine: String?, _ f: MapFilters) -> Bool {
        f.cuisines.isEmpty || f.cuisines.contains(cuisine ?? MapFilters.notSet)
    }

    /// One of ours, by every filter except cuisine and tags (whose choices come from what the others leave).
    public static func matchesOursExceptCuisineAndTags(_ place: Place, verdict: VerdictChoice, _ f: MapFilters, now: Date = .now) -> Bool {
        if !openWhen(f.when, periods: place.googleOpeningPeriods, utcOffsetMinutes: place.googleUTCOffsetMinutes, mealsByHand: place.mealsServed, now: now) { return false }
        if !f.prices.isEmpty && !f.prices.contains(place.googlePriceLevel ?? -1) { return false }
        if !f.verdicts.isEmpty && (place.status != .beenThere || !f.verdicts.contains(verdict)) { return false }
        return true
    }

    public static func matchesTags(_ place: Place, _ f: MapFilters) -> Bool {
        f.tags.isEmpty || f.tags.contains { place.tags.contains($0) }
    }

    public static func matchesOurs(_ place: Place, verdict: VerdictChoice, cuisine: String?, _ f: MapFilters, now: Date = .now) -> Bool {
        matchesOursExceptCuisineAndTags(place, verdict: verdict, f, now: now) && matchesCuisine(cuisine, f) && matchesTags(place, f)
    }

    public static func cuisine(ofGoogle place: NearbyPlace) -> String? {
        cuisineLabel(primaryType: place.primaryType, primaryTypeLabel: place.primaryTypeLabel)
    }

    /// One of Google's (not ours), by every filter except cuisine.
    public static func matchesGoogleExceptCuisine(_ p: NearbyPlace, _ f: MapFilters, now: Date = .now) -> Bool {
        if !openWhen(f.when, periods: p.openingHours?.periods, utcOffsetMinutes: p.utcOffsetMinutes, now: now) { return false }
        if !f.prices.isEmpty && !f.prices.contains(p.priceLevel ?? -1) { return false }
        if let min = f.minGoogleRating, (p.rating ?? 0) < min { return false }
        if let min = f.minReviews, (p.ratingsCount ?? 0) < min { return false }
        return true
    }

    public static func matchesGoogle(_ p: NearbyPlace, _ f: MapFilters, now: Date = .now) -> Bool {
        matchesGoogleExceptCuisine(p, f, now: now) && matchesCuisine(cuisine(ofGoogle: p), f)
    }

    public struct Choice: Hashable, Sendable {
        public let value: String
        public let count: Int

        public init(value: String, count: Int) {
            self.value = value
            self.count = count
        }
    }

    /// How many have each cuisine, most common first and "Not set" last.
    public static func counts(_ values: [String?]) -> [Choice] {
        var counts: [String: Int] = [:]
        for value in values { counts[value ?? MapFilters.notSet, default: 0] += 1 }
        return counts.map { Choice(value: $0.key, count: $0.value) }.sorted {
            if ($0.value == MapFilters.notSet) != ($1.value == MapFilters.notSet) { return $1.value == MapFilters.notSet }
            if $0.count != $1.count { return $0.count > $1.count }
            return $0.value.localizedCompare($1.value) == .orderedAscending
        }
    }

    /// Cuisines always offered (even when none are in view yet), with Google's type for each.
    public static let commonCuisines: [(label: String, type: String)] = [
        ("American", "american_restaurant"), ("Bakery", "bakery"), ("Barbecue", "barbecue_restaurant"), ("Breakfast", "breakfast_restaurant"),
        ("Brunch", "brunch_restaurant"), ("Cafe", "cafe"), ("Chinese", "chinese_restaurant"), ("Coffee Shop", "coffee_shop"),
        ("French", "french_restaurant"), ("Greek", "greek_restaurant"), ("Hamburger", "hamburger_restaurant"), ("Indian", "indian_restaurant"),
        ("Italian", "italian_restaurant"), ("Japanese", "japanese_restaurant"), ("Korean", "korean_restaurant"), ("Mediterranean", "mediterranean_restaurant"),
        ("Mexican", "mexican_restaurant"), ("Middle Eastern", "middle_eastern_restaurant"), ("Pizza", "pizza_restaurant"), ("Ramen", "ramen_restaurant"),
        ("Sandwich Shop", "sandwich_shop"), ("Seafood", "seafood_restaurant"), ("Spanish", "spanish_restaurant"), ("Steak House", "steak_house"),
        ("Sushi", "sushi_restaurant"), ("Thai", "thai_restaurant"), ("Vegan", "vegan_restaurant"), ("Vegetarian", "vegetarian_restaurant"),
        ("Vietnamese", "vietnamese_restaurant"),
    ]

    /// The cuisines in view (with counts) first, then the common ones not in view (count 0).
    public static func withCommonCuisines(_ inView: [Choice]) -> [Choice] {
        let have = Set(inView.map(\.value))
        return inView + commonCuisines.filter { !have.contains($0.label) }.map { Choice(value: $0.label, count: 0) }
    }

    /// Google's type for a cuisine ("Thai" → thai_restaurant).
    public static func googleType(forCuisine cuisine: String) -> String {
        if let known = commonCuisines.first(where: { $0.label == cuisine }) { return known.type }
        let snake = cuisine.lowercased().replacingOccurrences(of: "[^a-z]+", with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return "\(snake)_restaurant"
    }

    static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// "Today", "Tomorrow", "Sat".
    public static func dayLabel(_ day: Int, today: Int) -> String {
        day == today ? "Today" : day == (today + 1) % 7 ? "Tomorrow" : dayNames[day]
    }

    /// "Any time", "Open now", "Sat · breakfast", "Today · lunch".
    public static func whenLabel(_ when: MapWhen, today: Int) -> String {
        switch when {
        case .any: "Any time"
        case .now: "Open now"
        case .meal(let day, let meal): "\(dayLabel(day, today: today)) · \(meal.rawValue)"
        }
    }

    /// Today as 0 (Sunday) to 6.
    public static func today(_ now: Date = .now) -> Int {
        Calendar.current.component(.weekday, from: now) - 1
    }
}
