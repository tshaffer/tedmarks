import Foundation

/// Visit verdict: 👎 👌 👍
public enum VerdictValue: String, Codable, Sendable, CaseIterable {
    case wontReturn, tryAgain, wouldReturn
}

/// Item (dish) rating: 👎 👍 😍
public enum ItemRatingValue: String, Codable, Sendable, CaseIterable {
    case skip, good, loved
}

extension VerdictValue {
    public var emoji: String {
        switch self {
        case .wontReturn: "👎"
        case .tryAgain: "👌"
        case .wouldReturn: "👍"
        }
    }
}

extension ItemRatingValue {
    public var emoji: String {
        switch self {
        case .loved: "😍"
        case .good: "👍"
        case .skip: "👎"
        }
    }
}

public enum RatingScope: String, Codable, Sendable {
    case joint, person
}

public struct RatingInput<Value: Hashable & Sendable>: Sendable {
    public var scope: RatingScope
    public var personId: String?
    public var value: Value

    public init(scope: RatingScope, personId: String? = nil, value: Value) {
        self.scope = scope
        self.personId = personId
        self.value = value
    }
}

public enum RatingDisplay<Value: Hashable & Sendable>: Hashable, Sendable {
    case none
    case joint(Value)
    case split([PersonRating])

    public struct PersonRating: Hashable, Sendable {
        public var personId: String
        public var value: Value
        public init(personId: String, value: Value) {
            self.personId = personId
            self.value = value
        }
    }
}

/// "Joint unless we disagree".
///
/// For each household person p: effective(p) = p's own rating ?? the joint rating.
/// If every recorded effective rating is the same, show it as joint; otherwise split.
///
/// Mirrors shared/src/rules/ratings.ts; both are tested against shared/fixtures/ratings-cases.json.
public func displayRating<Value>(
    _ ratings: [RatingInput<Value>],
    household householdPersonIds: [String]
) -> RatingDisplay<Value> {
    let joint = ratings.first(where: { $0.scope == .joint })?.value
    var byPerson: [String: Value] = [:]
    for rating in ratings where rating.scope == .person {
        if let personId = rating.personId { byPerson[personId] = rating.value }
    }

    let effective: [RatingDisplay<Value>.PersonRating] = householdPersonIds.compactMap { personId in
        guard let value = byPerson[personId] ?? joint else { return nil }
        return .init(personId: personId, value: value)
    }

    guard let first = effective.first?.value else {
        if let joint { return .joint(joint) }
        return .none
    }
    if effective.allSatisfy({ $0.value == first }) { return .joint(first) }
    return .split(effective)
}
