import Foundation

public enum WhatToOrderGroup: String, Codable, Sendable {
    case orderAgain, disagree, skip, unrated
}

public struct WhatToOrderResult: Hashable, Sendable {
    public var placeItemId: String
    public var group: WhatToOrderGroup
    public var notOnLatestMenu: Bool
    public var ratedVisitCount: Int
}

/// Place page "What to order". Mirrors shared/src/rules/whatToOrder.ts.
/// The most recent rating decides (`displays` are newest visit first):
/// - disagree: it's split
/// - skip: it's a joint 👎
/// - orderAgain: it's a joint 😍/👍
/// - unrated: never rated
public func whatToOrder(
    placeItemId: String,
    onLatestMenu: Bool?,
    displays: [RatingDisplay<ItemRatingValue>]
) -> WhatToOrderResult {
    let rated = displays.filter { $0 != .none }
    let group: WhatToOrderGroup = switch rated.first {
    case nil, .none?: .unrated
    case .split?: .disagree
    case .joint(.skip)?: .skip
    case .joint?: .orderAgain
    }
    return WhatToOrderResult(
        placeItemId: placeItemId,
        group: group,
        notOnLatestMenu: onLatestMenu == false,
        ratedVisitCount: rated.count
    )
}
