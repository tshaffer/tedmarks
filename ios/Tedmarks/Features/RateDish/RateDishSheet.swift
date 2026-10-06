import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 04 · Rate a dish. Pick a dish, tap a rating — it saves and closes.
struct RateDishSheet: View {
    let visit: Visit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]

    @State private var rateFor: RateFor = .us
    @State private var selection: Selection?
    @State private var newDishName = ""
    @FocusState private var isTypingName: Bool
    @State private var errorMessage: String?

    enum Selection: Hashable {
        case orderItem(VisitItem)
        case previous(PlaceItem)
        case newName(String)
        case unnamed
    }

    init(visit: Visit, preselected: VisitItem? = nil) {
        self.visit = visit
        _selection = State(initialValue: preselected.map { .orderItem($0) })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    RateForPicker(selection: $rateFor, household: householdPeople)

                    if !orderItems.isEmpty {
                        chipSection("Our order") {
                            ForEach(orderItems) { item in
                                dishChip(item.displayName, badge: badge(for: item), selected: selection == .orderItem(item)) {
                                    select(.orderItem(item))
                                }
                            }
                        }
                    }

                    let previous = visit.place.map { DishCapture.orderedBefore(at: $0, excluding: visit) } ?? []
                    if !previous.isEmpty {
                        chipSection("Ordered before") {
                            ForEach(previous) { placeItem in
                                dishChip(placeItem.name, badge: nil, selected: selection == .previous(placeItem)) {
                                    select(.previous(placeItem))
                                }
                            }
                        }
                    }

                    if let place = visit.place {
                        let shown = Set(orderItems.compactMap { $0.placeItem?.id } + previous.map(\.id))
                        MenuChipSections(place: place, exclude: shown, filter: "") { placeItem in
                            dishChip(placeItem.name, badge: nil, selected: selection == .previous(placeItem)) {
                                select(.previous(placeItem))
                            }
                        }
                    }

                    chipSection("Something else?") {
                        dishChip("+ Unnamed dish", badge: nil, selected: selection == .unnamed, tint: .accentColor) {
                            select(.unnamed)
                        }
                    }
                    TextField("Dish name", text: $newDishName)
                        .textFieldStyle(.roundedBorder)
                        .focused($isTypingName)
                        .submitLabel(.done)
                        .onChange(of: newDishName) { _, name in
                            let trimmed = name.trimmingCharacters(in: .whitespaces)
                            selection = trimmed.isEmpty ? nil : .newName(trimmed)
                        }
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) { ratingCard }
            .navigationTitle("Rate a dish")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(visit.place?.name.uppercased() ?? "").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                        Text("Rate a dish").font(.headline)
                    }
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    // MARK: - Pieces

    private var ratingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(selectionTitle).font(.headline).lineLimit(1)
            RatingButtons(values: ItemRatingValue.buttonOrder, selected: currentValue) { value in
                save(value)
            }
            .disabled(selection == nil)
            .opacity(selection == nil ? 0.4 : 1)
            Text(footer).font(.footnote).foregroundStyle(.secondary)
        }
        .padding()
        .background(.bar)
    }

    private func chipSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            FlowLayout(spacing: 8) { content() }
        }
    }

    private func dishChip(_ title: String, badge: String?, selected: Bool, tint: Color = .primary, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title).lineLimit(1)
                if let badge { Text(badge).font(.footnote) }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .foregroundStyle(selected ? Color.white : tint)
            .background {
                if selected {
                    Capsule().fill(Color.accentColor)
                } else {
                    Capsule().strokeBorder(Color.secondary.opacity(0.35))
                }
            }
            .fixedSize()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Logic

    private var orderItems: [VisitItem] { DishCapture.orderItems(for: visit) }

    private var householdPeople: [Person] {
        let ids = DishCapture.household(for: visit, people: people)
        return ids.compactMap { id in people.first { $0.id == id } }
    }

    private var names: [String: String] {
        Dictionary(uniqueKeysWithValues: people.map { ($0.id.uuidString, $0.displayName) })
    }

    private func badge(for item: VisitItem) -> String? {
        let display = (try? DishCapture.display(for: item, household: householdPeople.map(\.id), in: context)) ?? .none
        switch display {
        case .none: return nil
        case .joint(let value): return value.emoji
        case .split(let people): return people.map(\.value.emoji).joined(separator: "/")
        }
    }

    private var selectionTitle: String {
        switch selection {
        case .orderItem(let item): "How was the \(item.displayName)?"
        case .previous(let placeItem): "How was the \(placeItem.name)?"
        case .newName(let name): "How was the \(name)?"
        case .unnamed: "How was it?"
        case nil: "Pick a dish"
        }
    }

    private var footer: String {
        let rated = orderItems.filter { badge(for: $0) != nil }.count
        return orderItems.isEmpty ? "Tap a rating to save." : "Tap a rating to save · \(rated) of \(orderItems.count) rated"
    }

    /// The value already recorded for the selected dish and the current Us/Ted/Lori choice.
    private var currentValue: ItemRatingValue? {
        guard case .orderItem(let item) = selection,
              let raw = (try? DishCapture.recordedValue(for: item.id, rateFor: rateFor, in: context)) ?? nil
        else { return nil }
        return ItemRatingValue(rawValue: raw)
    }

    private func select(_ newSelection: Selection) {
        selection = newSelection
        newDishName = ""
        isTypingName = false
    }

    private func save(_ value: ItemRatingValue) {
        do {
            let item: VisitItem?
            switch selection {
            case .orderItem(let existing): item = existing
            case .previous(let placeItem): item = try DishCapture.addItem(placeItem, to: visit, addedVia: .rating, in: context)
            case .newName(let name): item = try DishCapture.addItem(named: name, to: visit, addedVia: .rating, in: context)
            case .unnamed: item = try DishCapture.addUnnamedItem(to: visit, in: context)
            case nil: item = nil
            }
            guard let item else { return }
            let me = try VisitStarter.devicePerson(in: context)?.id
            try DishCapture.rate(item, value, for: rateFor, enteredBy: me, in: context)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
