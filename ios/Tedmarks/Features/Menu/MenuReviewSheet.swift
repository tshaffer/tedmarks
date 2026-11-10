import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 12f · checking what Claude read from new pages. The dishes are already usable; here
/// a wrong one can be removed (a new dish comes off the menu, a changed price goes back),
/// fixed, or one it missed added. "Later" keeps the review for another time.
struct MenuReviewSheet: View {
    let menu: PlaceMenu
    let place: Place

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [Row] = []
    @State private var editing: Row.ID?
    @State private var adding = false
    @State private var error: String?
    @State private var showingSame = false

    struct Row: Identifiable {
        let id = UUID()
        let original: MenuReviewItem?
        var dish: MenuItem
        var removed = false
    }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).foregroundStyle(.red).font(.subheadline)
                }
                Section {
                    ForEach(rows.filter { $0.original?.status != .same }) { row in rowView(row) }
                    Button { adding = true } label: { Label("Add a dish", systemImage: "plus").font(.subheadline) }
                } header: {
                    Text(summary)
                } footer: {
                    Text("Swipe to remove a dish Claude got wrong; tap one to fix it.")
                }
                let same = rows.filter { $0.original?.status == .same }
                if !same.isEmpty {
                    Section {
                        DisclosureGroup("Already on the menu (\(same.count))", isExpanded: $showingSame) {
                            ForEach(same) { row in rowView(row) }
                        }
                    }
                }
            }
            .navigationTitle("Check new dishes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Later") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: finish).bold() }
            }
            .sheet(item: Binding { rows.first { $0.id == editing } } set: { editing = $0?.id }) { row in
                EditDishSheet(dish: row.dish, isNew: false, sections: sections) { dish in
                    guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
                    rows[index].dish = dish
                    rows[index].removed = false
                }
            }
            .sheet(isPresented: $adding) {
                EditDishSheet(dish: MenuItem(section: nil, name: "", price: nil), isNew: true, sections: sections) { dish in
                    guard !dish.name.trimmingCharacters(in: .whitespaces).isEmpty else { throw MenuDishError.emptyName }
                    rows.append(Row(original: nil, dish: dish))
                }
            }
        }
        .onAppear {
            if rows.isEmpty { rows = (menu.review?.items ?? []).map { Row(original: $0, dish: $0.item) } }
        }
    }

    private var summary: String {
        let pages = menu.review?.pageIds.count ?? 0
        let added = rows.filter { $0.original?.status == .new }.count
        let changed = rows.filter { $0.original?.status == .changed }.count
        var parts = ["\(added) new"]
        if changed > 0 { parts.append("\(changed) new price\(changed == 1 ? "" : "s")") }
        return (pages > 0 ? "Read from \(pages) page\(pages == 1 ? "" : "s") · " : "") + parts.joined(separator: " · ")
    }

    private var sections: [String] {
        var seen: [String] = []
        for section in ((menu.extracted ?? []) + rows.map(\.dish)).compactMap(\.section) where !seen.contains(section) { seen.append(section) }
        return seen
    }

    @ViewBuilder
    private func rowView(_ row: Row) -> some View {
        Button { editing = row.id } label: {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.dish.name).strikethrough(row.removed).foregroundStyle(row.removed ? .secondary : .primary)
                    if let description = row.dish.description, !row.removed {
                        Text(description).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                    }
                    if let section = row.dish.section, !row.removed {
                        Text(section).font(.caption).foregroundStyle(.tertiary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if let price = row.dish.price { Text(price).foregroundStyle(.secondary).monospacedDigit() }
                    badge(row)
                }
            }
        }
        .tint(.primary)
        .swipeActions {
            if row.removed {
                Button("Keep") { set(row, removed: false) }.tint(.blue)
            } else {
                Button("Remove", role: .destructive) { set(row, removed: true) }
            }
        }
    }

    @ViewBuilder
    private func badge(_ row: Row) -> some View {
        let (text, color): (String, Color) = switch row.original?.status {
        case .new: ("New", .green)
        case .changed: ("Was \(row.original?.previousPrice ?? "no price")", .orange)
        case .same: ("On the menu", .secondary)
        case nil: ("Added", .blue)
        }
        Text(row.removed ? "Removed" : text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background((row.removed ? Color.secondary : color).opacity(0.15), in: Capsule())
            .foregroundStyle(row.removed ? .secondary : color)
    }

    private func set(_ row: Row, removed: Bool) {
        guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        rows[index].removed = removed
    }

    private func finish() {
        let edits = rows.compactMap { row -> MenuReviewEdit? in
            if row.original == nil { return row.removed ? nil : MenuReviewEdit(original: nil, edited: row.dish) }
            return MenuReviewEdit(original: row.original, edited: row.removed ? nil : row.dish)
        }
        do {
            try MenuReading.finishReview(menu, edits: edits, in: context)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
