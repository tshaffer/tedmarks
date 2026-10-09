import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 02b/02c · What did you order? Add dishes as they're ordered (rate them later from
/// the visit card or the Lock Screen). Stays open so several dishes go in quickly.
struct AddToOrderSheet: View {
    let visit: Visit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    // Re-render when order lines change.
    @Query(filter: #Predicate<VisitItem> { $0.deletedAt == nil }) private var visitItems: [VisitItem]

    @State private var dishName = ""
    @FocusState private var isTypingName: Bool
    @State private var errorMessage: String?
    @State private var pendingRemoval: VisitItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let place = visit.place { MenuPanel(place: place, visit: visit) }

                    HStack(spacing: 8) {
                        TextField("Search, or a dish not listed", text: $dishName)
                            .textFieldStyle(.roundedBorder)
                            .focused($isTypingName)
                            .submitLabel(.next)
                            .onSubmit { addTyped() }
                        Button("Add") { addTyped() }
                            .buttonStyle(.borderedProminent)
                            .disabled(trimmedName.isEmpty)
                    }

                    rowSection(orderItems.isEmpty ? "Our order" : "Our order · \(orderItems.reduce(0) { $0 + $1.count })") {
                        if orderItems.isEmpty {
                            Text("Nothing yet. Tap + on a dish below, or type one.")
                                .font(.subheadline).foregroundStyle(.secondary)
                                .padding(.vertical, 6)
                        } else {
                            ForEach(orderItems) { item in
                                row(item.displayName, detail: item.placeItem?.price, count: item.count,
                                    onAdd: { addOne(item) }, onRemove: { removeOne(item) })
                            }
                        }
                    }

                    if !suggestions.isEmpty {
                        rowSection(trimmedName.isEmpty ? "Ordered before" : "Ordered before · matches") {
                            ForEach(suggestions) { placeItem in
                                row(placeItem.name, detail: lastOrderedText(placeItem), count: 0,
                                    onAdd: { add(placeItem) }, onRemove: {})
                            }
                        }
                    }

                    if let place = visit.place {
                        MenuChipSections(place: place, exclude: shownElsewhere, filter: trimmedName, asRows: true) { placeItem in
                            row(placeItem.name, detail: placeItem.price, count: 0, onAdd: { add(placeItem) }, onRemove: {})
                        }
                    }
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(visit.place?.name.uppercased() ?? "").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                        Text("What did you order?").font(.headline)
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog(
                "Remove \(pendingRemoval?.displayName ?? "")?",
                isPresented: .constant(pendingRemoval != nil),
                titleVisibility: .visible
            ) {
                Button("Remove dish and its rating", role: .destructive) {
                    if let item = pendingRemoval { perform { try DishCapture.removeItem(item, in: context) } }
                    pendingRemoval = nil
                }
                Button("Cancel", role: .cancel) { pendingRemoval = nil }
            }
            .onAppear {
                // First visit with no menu: nothing to pick from, so go straight to typing.
                if suggestions.isEmpty && (visit.place?.latestMenuId == nil) { isTypingName = true }
            }
        }
    }

    // MARK: - Pieces

    private func rowSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            VStack(spacing: 0) { content() }
        }
    }

    /// A dish with a stepper, like a shopping list: [+] at 0, [−] n [+] once ordered.
    private func row(_ name: String, detail: String?, count: Int, onAdd: @escaping () -> Void, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.body.weight(count > 0 ? .semibold : .regular))
                if let detail, !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            OrderStepper(count: count, name: name, onAdd: onAdd, onRemove: onRemove)
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 10)
        .background(count > 0 ? Color.orange.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Logic

    private var trimmedName: String { dishName.trimmingCharacters(in: .whitespaces) }

    private var orderItems: [VisitItem] {
        _ = visitItems.count
        return DishCapture.orderItems(for: visit)
    }

    /// Dishes from earlier visits, narrowed to those matching what's typed.
    /// Dishes already in our order or under "Ordered before" (not repeated under the menu).
    private var shownElsewhere: Set<UUID> {
        Set(orderItems.compactMap { $0.placeItem?.id } + suggestions.map(\.id))
    }

    private var suggestions: [PlaceItem] {
        _ = visitItems.count
        let previous = visit.place.map { DishCapture.orderedBefore(at: $0, excluding: visit) } ?? []
        let typed = normalizeItemName(trimmedName)
        guard !typed.isEmpty else { return previous }
        return previous.filter { $0.normalizedName.contains(typed) }
    }

    private func addTyped() {
        let name = trimmedName
        guard !name.isEmpty else { return }
        perform { try DishCapture.addOne(named: name, to: visit, addedVia: .order, in: context) }
        dishName = ""
        isTypingName = true
    }

    private func add(_ placeItem: PlaceItem) {
        perform { try DishCapture.addOne(placeItem, to: visit, addedVia: .order, in: context) }
        dishName = ""
    }

    private func addOne(_ item: VisitItem) {
        guard let placeItem = item.placeItem else { return }
        perform { try DishCapture.addOne(placeItem, to: visit, addedVia: .order, in: context) }
    }

    /// One fewer. The last one of an unrated dish goes right away; a rated one asks first so a
    /// stray tap doesn't lose its rating.
    private func removeOne(_ item: VisitItem) {
        let isRated = !((try? DishCapture.ratings(for: item.id, in: context)) ?? []).isEmpty
        if item.count > 1 {
            perform { try DishCapture.removeOne(item, in: context) }
        } else if isRated {
            pendingRemoval = item
        } else {
            perform { try DishCapture.removeItem(item, in: context) }
        }
    }

    /// "Ordered 3 times · last Mar 4"
    private func lastOrderedText(_ placeItem: PlaceItem) -> String? {
        let visits = (visit.place?.visits ?? []).filter { other in
            other.id != visit.id && other.deletedAt == nil
                && DishCapture.orderItems(for: other).contains { $0.placeItem?.id == placeItem.id }
        }
        guard let last = visits.map(\.startedAt).max() else { return placeItem.price }
        let times = visits.count == 1 ? "Ordered once" : "Ordered \(visits.count) times"
        return [times, "last \(last.formatted(date: .abbreviated, time: .omitted))", placeItem.price]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private func perform(_ action: () throws -> Void) {
        do {
            try action()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// [−] n [+], or just [+] at 0.
private struct OrderStepper: View {
    let count: Int
    let name: String
    let onAdd: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            if count > 0 {
                Button(action: onRemove) { Image(systemName: "minus").frame(width: 34, height: 30) }
                    .accessibilityLabel("One less \(name)")
                Text("\(count)").font(.subheadline.weight(.bold)).monospacedDigit().frame(minWidth: 16)
            }
            Button(action: onAdd) { Image(systemName: "plus").frame(width: 34, height: 30) }
                .accessibilityLabel("Add \(name)")
        }
        .font(.subheadline.weight(.bold))
        .foregroundStyle(count > 0 ? Color.orange : Color.secondary)
        .buttonStyle(.plain)
        .background {
            Capsule().strokeBorder(count > 0 ? Color.orange : Color.secondary.opacity(0.35))
        }
    }
}
