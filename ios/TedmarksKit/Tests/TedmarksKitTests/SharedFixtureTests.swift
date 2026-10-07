import Foundation
import Testing
@testable import TedmarksKit

/// Runs the same JSON cases as the TypeScript tests (shared/fixtures), so the
/// Swift and TypeScript rules can't drift apart.
private func fixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // TedmarksKitTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // TedmarksKit
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // tedmarks
        .appendingPathComponent("shared/fixtures/\(name)")
}

private struct FixtureRating: Decodable {
    var scope: RatingScope
    var personId: String?
    var value: String
}

private struct FixtureDisplay: Decodable {
    var kind: String
    var value: String?
    var byPerson: [FixturePersonRating]?

    func toDisplay() -> RatingDisplay<String> {
        switch kind {
        case "joint": return .joint(value!)
        case "split": return .split(byPerson!.map { .init(personId: $0.personId, value: $0.value) })
        default: return .none
        }
    }
}

private struct FixturePersonRating: Decodable {
    var personId: String
    var value: String
}

private struct RatingsFixture: Decodable {
    struct Case: Decodable {
        var name: String
        var ratings: [FixtureRating]
        var expected: FixtureDisplay
    }
    var household: [String]
    var cases: [Case]
}

private struct WhatToOrderFixture: Decodable {
    struct Input: Decodable {
        var placeItemId: String
        var onLatestMenu: Bool?
        var displays: [FixtureDisplay]
    }
    struct Expected: Decodable {
        var group: WhatToOrderGroup
        var notOnLatestMenu: Bool
        var ratedVisitCount: Int
    }
    struct Case: Decodable {
        var name: String
        var input: Input
        var expected: Expected
    }
    var cases: [Case]
}

private func load<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: fixtureURL(name)))
}

@Test func displayRatingMatchesSharedFixtures() throws {
    let fixture = try load(RatingsFixture.self, "ratings-cases.json")
    #expect(!fixture.cases.isEmpty)
    for testCase in fixture.cases {
        let inputs = testCase.ratings.map { RatingInput(scope: $0.scope, personId: $0.personId, value: $0.value) }
        let actual = displayRating(inputs, household: fixture.household)
        #expect(actual == testCase.expected.toDisplay(), "\(testCase.name)")
    }
}

@Test func whatToOrderMatchesSharedFixtures() throws {
    let fixture = try load(WhatToOrderFixture.self, "what-to-order-cases.json")
    #expect(!fixture.cases.isEmpty)
    for testCase in fixture.cases {
        let displays: [RatingDisplay<ItemRatingValue>] = testCase.input.displays.map { d in
            switch d.toDisplay() {
            case .none: return .none
            case .joint(let v): return .joint(ItemRatingValue(rawValue: v)!)
            case .split(let people):
                return .split(people.map { .init(personId: $0.personId, value: ItemRatingValue(rawValue: $0.value)!) })
            }
        }
        let actual = whatToOrder(placeItemId: testCase.input.placeItemId, onLatestMenu: testCase.input.onLatestMenu, displays: displays)
        #expect(actual.group == testCase.expected.group, "\(testCase.name)")
        #expect(actual.notOnLatestMenu == testCase.expected.notOnLatestMenu, "\(testCase.name)")
        #expect(actual.ratedVisitCount == testCase.expected.ratedVisitCount, "\(testCase.name)")
    }
}

private struct PlaceWithoutVisitsFixture: Decodable {
    struct Input: Decodable {
        var status: PlaceStatus
        var hasInterest: Bool
        var hasReview: Bool
        var hasMenuOrNotes: Bool
    }
    struct Case: Decodable {
        var name: String
        var input: Input
        var expected: PlaceWithoutVisitsAction
    }
    var cases: [Case]
}

@Test func placeWithoutVisitsMatchesSharedFixtures() throws {
    let fixture = try load(PlaceWithoutVisitsFixture.self, "place-without-visits-cases.json")
    #expect(!fixture.cases.isEmpty)
    for testCase in fixture.cases {
        let input = testCase.input
        let actual = placeWithoutVisits(status: input.status, hasInterest: input.hasInterest, hasReview: input.hasReview, hasMenuOrNotes: input.hasMenuOrNotes)
        #expect(actual == testCase.expected, "\(testCase.name)")
    }
}
