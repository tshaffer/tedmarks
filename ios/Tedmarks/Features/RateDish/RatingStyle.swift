import SwiftUI
import TedmarksKit

/// Emoji, labels and colors for rating values (Figma 04/05).
protocol RatingStyle: RawRepresentable, CaseIterable, Hashable, Sendable where RawValue == String {
    var emoji: String { get }
    var label: String { get }
    var color: Color { get }
}

extension ItemRatingValue: RatingStyle {
    /// Display order on buttons: 😍 👍 👎
    static var buttonOrder: [ItemRatingValue] { [.loved, .good, .skip] }
    var emoji: String {
        switch self {
        case .loved: "😍"
        case .good: "👍"
        case .skip: "👎"
        }
    }
    var label: String {
        switch self {
        case .loved: "Loved"
        case .good: "Good"
        case .skip: "Skip it"
        }
    }
    var color: Color {
        switch self {
        case .loved: .pink
        case .good: .green
        case .skip: .red
        }
    }
}

extension VerdictValue: RatingStyle {
    /// Display order on buttons: 👎 👌 👍
    static var buttonOrder: [VerdictValue] { [.wontReturn, .tryAgain, .wouldReturn] }
    var emoji: String {
        switch self {
        case .wontReturn: "👎"
        case .tryAgain: "👌"
        case .wouldReturn: "👍"
        }
    }
    var label: String {
        switch self {
        case .wontReturn: "Won't return"
        case .tryAgain: "Try again"
        case .wouldReturn: "Would return"
        }
    }
    var color: Color {
        switch self {
        case .wontReturn: .red
        case .tryAgain: .orange
        case .wouldReturn: .green
        }
    }
}

/// A row of big rating buttons; `selected` is highlighted.
struct RatingButtons<Value: RatingStyle>: View {
    let values: [Value]
    let selected: Value?
    var compact = false
    let onTap: (Value) -> Void

    var body: some View {
        HStack(spacing: compact ? 6 : 10) {
            ForEach(values, id: \.self) { value in
                let isOn = value == selected
                Button {
                    onTap(value)
                } label: {
                    VStack(spacing: compact ? 0 : 4) {
                        Text(value.emoji).font(compact ? .body : .system(size: 34))
                        if !compact {
                            Text(value.label).font(.footnote.weight(.semibold))
                        }
                    }
                    .frame(maxWidth: compact ? nil : .infinity)
                    .frame(width: compact ? 40 : nil, height: compact ? 34 : nil)
                    .padding(.vertical, compact ? 0 : 12)
                    .foregroundStyle(isOn ? Color.white : value.color)
                    .background(value.color.opacity(isOn ? 1 : 0.13), in: RoundedRectangle(cornerRadius: compact ? 17 : 14))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(value.label)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
    }
}

/// Text for a computed display: "😍", or "Lori 😍 · Ted 👎" when we disagree.
func displayText<V: RatingStyle>(_ display: RatingDisplay<V>, names: [String: String]) -> String? {
    switch display {
    case .none: nil
    case .joint(let value): value.emoji
    case .split(let people):
        people.map { "\(names[$0.personId] ?? "?") \($0.value.emoji)" }.joined(separator: " · ")
    }
}
