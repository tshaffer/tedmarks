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
                        TextField("Dish name", text: $dishName)
                            .textFieldStyle(.roundedBorder)
                            .focused($isTypingName)
                            .submitLabel(.next)
                            .onSubmit { addTyped() }
                        Button("Add") { addTyped() }
                            .buttonStyle(.borderedProminent)
                            .disabled(trimmedName.isEmpty)
                    }

                    if !suggestions.isEmpty {
                        chipSection(trimmedName.isEmpty ? "Ordered before" : "Matches") {
                            ForEach(suggestions) { placeItem in
                                chip(placeItem.name, systemImage: "plus") { add(placeItem) }
                            }
                        }
                    }

                    if let place = visit.place {
                        MenuChipSections(place: place, exclude: shownElsewhere, filter: trimmedName) { placeItem in
                            chip(placeItem.name, systemImage: "plus") { add(placeItem) }
                        }
                    }

                    chipSection(orderItems.isEmpty ? "Our order" : "Our order · \(orderItems.count)") {
                        if orderItems.isEmpty {
                            Text("Nothing yet. Type a dish or tap one above.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        } else {
                            ForEach(orderItems) { item in
                                chip(item.displayName, systemImage: "xmark", filled: true) { remove(item) }
                            }
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
                // First visit: nothing to pick from, so go straight to typing.
                if suggestions.isEmpty { isTypingName = true }
            }
        }
    }

    // MARK: - Pieces

    private func chipSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            FlowLayout(spacing: 8) { content() }
        }
    }

    private func chip(_ title: String, systemImage: String, filled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title).lineLimit(1)
                Image(systemName: systemImage).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .background {
                if filled {
                    Capsule().fill(Color(.secondarySystemFill))
                } else {
                    Capsule().strokeBorder(Color.secondary.opacity(0.35))
                }
            }
            .fixedSize()
        }
        .buttonStyle(.plain)
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
        perform { try DishCapture.addItem(named: name, to: visit, addedVia: .order, in: context) }
        dishName = ""
        isTypingName = true
    }

    private func add(_ placeItem: PlaceItem) {
        perform { try DishCapture.addItem(placeItem, to: visit, addedVia: .order, in: context) }
        dishName = ""
    }

    /// Unrated dishes go right away; a rated one asks first so a stray tap doesn't lose its rating.
    private func remove(_ item: VisitItem) {
        let isRated = !((try? DishCapture.ratings(for: item.id, in: context)) ?? []).isEmpty
        if isRated {
            pendingRemoval = item
        } else {
            perform { try DishCapture.removeItem(item, in: context) }
        }
    }

    private func perform(_ action: () throws -> Void) {
        do {
            try action()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
