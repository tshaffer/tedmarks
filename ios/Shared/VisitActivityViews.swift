import AppIntents
import SwiftUI
import TedmarksKit

// Live Activity views (Figma 03). Compiled into both the widget extension (which renders
// them) and the app (debug preview). iOS caps the Lock Screen card's height
// (~160 pt), so this is three compact rows: header, question, buttons.

struct LockScreenVisitView: View {
    let attributes: VisitActivityAttributes
    let state: VisitActivityContent

    init(attributes: VisitActivityAttributes, state: VisitActivityContent) {
        self.attributes = attributes
        self.state = state
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "fork.knife")
                    .font(.subheadline.weight(.semibold))
                    .frame(width: 30, height: 30)
                    .background(Color.orange, in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(.white)
                VStack(alignment: .leading, spacing: 0) {
                    Text(attributes.placeName).font(.headline).foregroundStyle(.white).lineLimit(1)
                    HStack(spacing: 4) {
                        Text(attributes.participants)
                        Text("·")
                        Text(attributes.startedAt, style: .relative)
                    }
                    .font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                }
                Spacer(minLength: 4)
                RatedCount(state: state)
            }
            QuickRate(attributes: attributes, state: state, showsLinks: true)
        }
    }
}

struct RatedCount: View {
    let state: VisitActivityContent

    init(state: VisitActivityContent) { self.state = state }

    var body: some View {
        if state.totalCount > 0 {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(state.ratedCount)/\(state.totalCount)").font(.title3.weight(.bold)).foregroundStyle(.orange)
                Text("rated").font(.caption2).foregroundStyle(.white.opacity(0.6))
            }
        }
    }
}

/// The question on its own line, then 😍 👍 👎 for the next unrated dish — or, once every
/// dish is rated, 👍 👌 👎 for the verdict (which ends the visit).
struct QuickRate: View {
    let attributes: VisitActivityAttributes
    let state: VisitActivityContent
    let showsLinks: Bool

    init(attributes: VisitActivityAttributes, state: VisitActivityContent, showsLinks: Bool = false) {
        self.attributes = attributes
        self.state = state
        self.showsLinks = showsLinks
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let dish = state.nextUnrated {
                question("How was the \(dish.name)?")
                HStack(spacing: 8) {
                    ForEach([ItemRatingValue.loved, .good, .skip], id: \.self) { value in
                        Button(intent: RateDishIntent(visitItemId: dish.id, rating: value)) { emojiLabel(value.emoji) }
                            .buttonStyle(.plain)
                    }
                    links
                }
            } else {
                question("Would you come back?")
                HStack(spacing: 8) {
                    ForEach([VerdictValue.wouldReturn, .tryAgain, .wontReturn], id: \.self) { value in
                        Button(intent: SetVerdictIntent(visitId: attributes.visitId, verdict: value)) { emojiLabel(value.emoji) }
                            .buttonStyle(.plain)
                    }
                    links
                }
            }
        }
    }

    private func question(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.8)
    }

    @ViewBuilder
    private var links: some View {
        if showsLinks, let visitId = UUID(uuidString: attributes.visitId) {
            Spacer(minLength: 4)
            Link(destination: TedmarksLink.rateDish(visitId: visitId)) {
                Image(systemName: "plus")
                    .font(.subheadline.weight(.bold))
                    .frame(width: 38, height: 36)
                    .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 11))
                    .foregroundStyle(.white)
            }
            .accessibilityLabel("Rate a dish")
            Link(destination: TedmarksLink.wrapUp(visitId: visitId)) {
                Text("Wrap up")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(Color.orange, in: RoundedRectangle(cornerRadius: 11))
                    .foregroundStyle(.black)
            }
        }
    }

    private func emojiLabel(_ emoji: String) -> some View {
        Text(emoji).font(.title3)
            .frame(width: 44, height: 36)
            .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 11))
    }
}

