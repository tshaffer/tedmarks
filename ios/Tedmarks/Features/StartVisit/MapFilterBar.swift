import SwiftUI
import TedmarksKit

/// The map's filters, as on the website: When · Cuisine · Price · Our verdict · Tags (· Google
/// rating while Google's pins show), then Clear. Each chip opens a menu; the multi-choice ones
/// stay open so several can be ticked.
struct MapFilterBar: View {
    @Binding var filters: MapFilters
    let cuisines: [MapFiltering.Choice]
    let tags: [MapFiltering.Choice]
    let showsGoogle: Bool

    private static let prices = (1...4).map { MapFiltering.Choice(value: String($0), count: 0) }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                whenMenu
                MultiChoiceChip(title: "Cuisine", plural: "cuisines", anyLabel: "Any cuisine", choices: cuisines,
                                label: { $0 == MapFilters.notSet ? "Not set" : $0 }, selected: $filters.cuisines)
                MultiChoiceChip(title: "Price", plural: "prices", anyLabel: "Any price", choices: Self.prices,
                                label: { String(repeating: "$", count: Int($0) ?? 1) },
                                selected: Binding(get: { filters.prices.map(String.init) }, set: { filters.prices = $0.compactMap(Int.init) }))
                MultiChoiceChip(title: "Our verdict", plural: "verdicts", anyLabel: "Any verdict",
                                choices: VerdictChoice.allCases.map { .init(value: $0.rawValue, count: 0) },
                                label: { VerdictChoice(rawValue: $0)?.label ?? $0 },
                                selected: Binding(get: { filters.verdicts.map(\.rawValue) }, set: { filters.verdicts = $0.compactMap(VerdictChoice.init) }))
                MultiChoiceChip(title: "Tags", plural: "tags", anyLabel: "Any tag", choices: tags, label: { $0 },
                                selected: $filters.tags, empty: "No tags here yet")
                if showsGoogle { googleMenu }
                if filters.activeCount > 0 {
                    Button("Clear") { filters = MapFilters() }
                        .font(.subheadline)
                        .padding(.horizontal, 6)
                }
            }
            .padding(.vertical, 1)
        }
    }

    // MARK: - When

    private var whenMenu: some View {
        let today = MapFiltering.today()
        return Menu {
            checkable("Any time", isOn: filters.when == .any) { filters.when = .any }
            checkable("Open now", isOn: filters.when == .now) { filters.when = .now }
            Section("Open for a meal on…") {
                ForEach(0..<7, id: \.self) { offset in
                    let day = (today + offset) % 7
                    Menu(MapFiltering.dayLabel(day, today: today)) {
                        ForEach(Meal.allCases, id: \.self) { meal in
                            checkable(meal.label, isOn: filters.when == .meal(day: day, meal: meal)) { filters.when = .meal(day: day, meal: meal) }
                        }
                    }
                }
            }
        } label: {
            FilterChipLabel(text: MapFiltering.whenLabel(filters.when, today: today), isOn: filters.when != .any)
        }
    }

    // MARK: - Google rating

    private var googleMenu: some View {
        let on = filters.minGoogleRating != nil || filters.minReviews != nil
        let parts = [filters.minGoogleRating.map { "Google \(Self.rating($0))+" }, filters.minReviews.map { "\($0.formatted())+ reviews" }].compactMap { $0 }
        return Menu {
            Section("Google rating (Google’s restaurants)") {
                ForEach([0, 4, 4.5, 4.8], id: \.self) { value in
                    checkable(value == 0 ? "Any rating" : "\(Self.rating(value))+", isOn: (filters.minGoogleRating ?? 0) == value) {
                        filters.minGoogleRating = value == 0 ? nil : value
                    }
                }
            }
            Section("At least … reviews") {
                ForEach([0, 50, 200, 1000], id: \.self) { value in
                    checkable(value == 0 ? "Any number" : value.formatted(), isOn: (filters.minReviews ?? 0) == value) {
                        filters.minReviews = value == 0 ? nil : value
                    }
                }
            }
        } label: {
            FilterChipLabel(text: on ? parts.joined(separator: " · ") : "Google rating", isOn: on)
        }
        .menuActionDismissBehavior(.disabled)
    }

    private static func rating(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    private func checkable(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if isOn { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
    }
}

/// A chip whose menu ticks any number of choices; none ticked = any.
private struct MultiChoiceChip: View {
    let title: String
    let plural: String
    let anyLabel: String
    let choices: [MapFiltering.Choice]
    let label: (String) -> String
    @Binding var selected: [String]
    var empty = "Nothing to choose"

    var body: some View {
        // Ticked choices stay listed even when nothing in view has them.
        let listed = selected.filter { value in !choices.contains { $0.value == value } }.map { MapFiltering.Choice(value: $0, count: 0) } + choices
        Menu {
            if !selected.isEmpty {
                Button(anyLabel) { selected = [] }
            }
            ForEach(listed, id: \.value) { choice in
                Button {
                    if let index = selected.firstIndex(of: choice.value) { selected.remove(at: index) } else { selected.append(choice.value) }
                } label: {
                    let text = choice.count > 0 ? "\(label(choice.value)) · \(choice.count)" : label(choice.value)
                    if selected.contains(choice.value) { Label(text, systemImage: "checkmark") } else { Text(text) }
                }
            }
            if listed.isEmpty {
                Text(empty)
            }
        } label: {
            FilterChipLabel(text: chipText, isOn: !selected.isEmpty)
        }
        .menuActionDismissBehavior(.disabled)
    }

    private var chipText: String {
        switch selected.count {
        case 0: title
        case 1: label(selected[0])
        default: "\(selected.count) \(plural)"
        }
    }
}

/// "Cuisine ▾": outlined, or tinted orange when the filter is on (as on the website).
struct FilterChipLabel: View {
    let text: String
    let isOn: Bool

    var body: some View {
        HStack(spacing: 3) {
            Text(text).lineLimit(1)
            Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
        }
        .font(.subheadline.weight(isOn ? .semibold : .regular))
        .foregroundStyle(isOn ? Color.orange : Color.primary)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background {
            if isOn {
                Capsule().fill(Color.orange.opacity(0.14))
            } else {
                Capsule().fill(Color(.secondarySystemGroupedBackground))
            }
        }
        .overlay {
            Capsule().strokeBorder(isOn ? Color.orange.opacity(0.4) : Color.secondary.opacity(0.3))
        }
        .contentShape(Capsule())
    }
}
