import ActivityKit
import AppIntents
import SwiftUI
import TedmarksKit
import WidgetKit

/// Figma 03 · Live Activity: "At Doppio Zero" on the Lock Screen and Dynamic Island.
struct VisitLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VisitActivityAttributes.self) { context in
            LockScreenVisitView(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color.black.opacity(0.78))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.placeName, systemImage: "fork.knife")
                        .font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RatedCount(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    QuickRate(attributes: context.attributes, state: context.state)
                }
            } compactLeading: {
                Image(systemName: "fork.knife").foregroundStyle(.orange)
            } compactTrailing: {
                Text("\(context.state.ratedCount)/\(context.state.totalCount)").foregroundStyle(.orange)
            } minimal: {
                Image(systemName: "fork.knife").foregroundStyle(.orange)
            }
            .widgetURL(visitURL(context.attributes))
        }
    }
}

private func visitURL(_ attributes: VisitActivityAttributes) -> URL? {
    UUID(uuidString: attributes.visitId).map { TedmarksLink.wrapUp(visitId: $0) }
}

#if DEBUG
#Preview("Lock Screen", as: .content, using: VisitActivityAttributes(
    visitId: UUID().uuidString, placeName: "Doppio Zero", participants: "Ted and Lori", startedAt: .now.addingTimeInterval(-2340)
)) {
    VisitLiveActivity()
} contentStates: {
    VisitActivityContent(dishes: [
        .init(id: "1", name: "Burrata", badge: "😍"),
        .init(id: "2", name: "Doppio Zero pizza", badge: "👍"),
        .init(id: "3", name: "Funghi pizza", badge: nil),
    ], ratedCount: 2, verdictEmoji: nil)
}
#endif
