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
/// - disagree: any visit's rating is split
/// - skip: otherwise, any joint 👎
/// - orderAgain: otherwise, at least one rating and all 😍/👍
/// - unrated: no ratings
public func whatToOrder(
    placeItemId: String,
    onLatestMenu: Bool?,
    displays: [RatingDisplay<ItemRatingValue>]
) -> WhatToOrderResult {
    let rated = displays.filter { $0 != .none }
    let group: WhatToOrderGroup
    if rated.contains(where: { if case .split = $0 { true } else { false } }) {
        group = .disagree
    } else if rated.contains(.joint(.skip)) {
        group = .skip
    } else if !rated.isEmpty {
        group = .orderAgain
    } else {
        group = .unrated
    }
    return WhatToOrderResult(
        placeItemId: placeItemId,
        group: group,
        notOnLatestMenu: onLatestMenu == false,
        ratedVisitCount: rated.count
    )
}
