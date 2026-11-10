import SwiftData
import SwiftUI
import TedmarksKit

/// What to open the menu at.
struct MenuSheetTarget: Identifiable {
    enum Tab: Hashable { case dishes, pages }
    let menu: PlaceMenu
    var tab: Tab = .dishes
    var page = 0
    var id: String { "\(menu.id)-\(tab)-\(page)" }
}

/// The restaurant's menu: its dishes (by section, with descriptions, prices and how we rated
/// the ones we've had; editable on the latest menu) and its pages.
struct MenuSheet: View {
    let target: MenuSheetTarget
    let place: Place

    @Environment(\.dismiss) private var dismiss
    @State private var tab: MenuSheetTarget.Tab = .dishes

    private var menu: PlaceMenu { target.menu }
    private var hasPages: Bool { !menu.pages.isEmpty || !menu.pagePhotoIds.isEmpty }

    var body: some View {
        NavigationStack {
            Group {
                switch tab {
                case .dishes: MenuDishesList(menu: menu, place: place)
                case .pages:
                    if menu.pages.isEmpty { MenuPagesContent(menu: menu) } else { MenuServerPages(pages: menu.pages, start: target.page) }
                }
            }
            .navigationTitle("Menu · \(menu.capturedAt.formatted(date: .abbreviated, time: .omitted))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if hasPages {
                    ToolbarItem(placement: .principal) {
                        Picker("Show", selection: $tab) {
                            Text("Dishes").tag(MenuSheetTarget.Tab.dishes)
                            Text("Pages").tag(MenuSheetTarget.Tab.pages)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 200)
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .onAppear { tab = hasPages ? target.tab : .dishes }
    }
}

/// A dish open for editing: which one (nil = a new one) and what it is now.
struct DishEditTarget: Identifiable {
    let id = UUID()
    let index: Int?
    let dish: MenuItem
}

/// Figma 12c/12g · the menu's dishes in menu order, with our latest rating where we've had
/// them. On the latest menu, tap a dish to edit it, or add one.
private struct MenuDishesList: View {
    let menu: PlaceMenu
    let place: Place

    @Environment(\.modelContext) private var context
    @State private var editing: DishEditTarget?
    @State private var query = ""

    private var editable: Bool { place.latestMenuId == menu.id && menu.readStatus == .read }

    var body: some View {
        let entries = Array((menu.extracted ?? []).enumerated())
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matching = entries.filter { q.isEmpty || $0.element.name.lowercased().contains(q) || ($0.element.description ?? "").lowercased().contains(q) }
        let sections = Self.sections(matching)
        let ratings = latestRatings()
        List {
            if entries.isEmpty {
                Text(menu.readStatus == .read ? "No dishes on this menu yet." : "This menu hasn't been read yet.")
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                Section(section.title ?? "Menu") {
                    ForEach(section.items, id: \.offset) { index, item in
                        Button {
                            if editable { editing = DishEditTarget(index: index, dish: item) }
                        } label: {
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(item.name).foregroundStyle(.primary)
                                        if let badge = ratings[normalizeItemName(item.name)] { Text(badge).font(.subheadline) }
                                    }
                                    if let description = item.description {
                                        Text(description).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                                    }
                                }
                                Spacer()
                                if let price = item.price {
                                    Text(price).foregroundStyle(.secondary).monospacedDigit()
                                }
                            }
                        }
                        .tint(.primary)
                        .disabled(!editable)
                    }
                    if editable && q.isEmpty {
                        Button {
                            editing = DishEditTarget(index: nil, dish: MenuItem(section: section.title, name: "", price: nil))
                        } label: {
                            Label("Add a dish" + (section.title.map { " to \($0)" } ?? ""), systemImage: "plus")
                                .font(.subheadline)
                        }
                    }
                }
            }
            if editable && entries.isEmpty {
                Button { editing = DishEditTarget(index: nil, dish: MenuItem(section: nil, name: "", price: nil)) } label: {
                    Label("Add a dish", systemImage: "plus")
                }
            }
        }
        .searchable(text: $query, prompt: "Search dishes and descriptions")
        .sheet(item: $editing) { target in
            EditDishSheet(dish: target.dish, isNew: target.index == nil, sections: sectionNames) { dish in
                try MenuReading.editDish(in: menu, at: target.index ?? (menu.extracted?.count ?? 0), to: dish, in: context)
            } onDelete: { [index = target.index] in
                guard let index else { return }
                try MenuReading.editDish(in: menu, at: index, to: nil, in: context)
            }
        }
    }

    private var sectionNames: [String] {
        var seen: [String] = []
        for section in (menu.extracted ?? []).compactMap(\.section) where !seen.contains(section) { seen.append(section) }
        return seen
    }

    private static func sections(_ items: [(offset: Int, element: MenuItem)]) -> [(title: String?, items: [(offset: Int, element: MenuItem)])] {
        var sections: [(title: String?, items: [(offset: Int, element: MenuItem)])] = []
        for item in items {
            if let last = sections.last, last.title == item.element.section {
                sections[sections.count - 1].items.append(item)
            } else {
                sections.append((item.element.section, [item]))
            }
        }
        return sections
    }

    /// Normalized dish name → our latest rating as emoji ("😍", or "👎/😍" when we disagree).
    private func latestRatings() -> [String: String] {
        guard let insights = try? PlaceInsights(context: context) else { return [:] }
        var result: [String: String] = [:]
        for dish in insights.dishes(at: place) {
            switch dish.latest {
            case .none: continue
            case .joint(let value): result[dish.item.normalizedName] = value.emoji
            case .split(let people): result[dish.item.normalizedName] = people.map(\.value.emoji).joined(separator: "/")
            }
        }
        return result
    }
}

/// Figma 12g · one dish: name, price, section and description.
struct EditDishSheet: View {
    let isNew: Bool
    let sections: [String]
    let onSave: (MenuItem) throws -> Void
    var onDelete: (() throws -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var dish: MenuItem
    @State private var error: String?
    @State private var confirmingDelete = false

    init(dish: MenuItem, isNew: Bool, sections: [String], onSave: @escaping (MenuItem) throws -> Void, onDelete: (() throws -> Void)? = nil) {
        _dish = State(initialValue: dish)
        self.isNew = isNew
        self.sections = sections
        self.onSave = onSave
        self.onDelete = onDelete
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    Text(error).foregroundStyle(.red).font(.subheadline)
                }
                Section {
                    TextField("Dish", text: $dish.name)
                    TextField("Price", text: Binding { dish.price ?? "" } set: { dish.price = $0 })
                        .keyboardType(.numbersAndPunctuation)
                    HStack {
                        TextField("Section", text: Binding { dish.section ?? "" } set: { dish.section = $0 })
                        if !sections.isEmpty {
                            Menu {
                                ForEach(sections, id: \.self) { name in Button(name) { dish.section = name } }
                            } label: {
                                Image(systemName: "chevron.up.chevron.down").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Description") {
                    TextField("As printed under the dish", text: Binding { dish.description ?? "" } set: { dish.description = $0 }, axis: .vertical)
                        .lineLimit(2...6)
                }
                if !isNew, onDelete != nil {
                    Section {
                        Button("Delete dish", role: .destructive) { confirmingDelete = true }
                    } footer: {
                        Text("Takes it off the menu. Visits where you ordered it keep it.")
                    }
                }
            }
            .navigationTitle(isNew ? "Add a dish" : "Edit dish")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { run { try onSave(dish) } }
                        .disabled(dish.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Delete \(dish.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete dish", role: .destructive) { run { try onDelete?() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func run(_ work: () throws -> Void) {
        do {
            try work()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The menu's page photos, from Photos, swipeable.
struct MenuPagesContent: View {
    let menu: PlaceMenu

    @Query private var photos: [Photo]
    @State private var images: [Int: UIImage] = [:]
    @State private var missing = false

    var body: some View {
        TabView {
            ForEach(Array(menu.pagePhotoIds.enumerated()), id: \.offset) { index, _ in
                Group {
                    if let image = images[index] {
                        ScrollView([.horizontal, .vertical]) {
                            Image(uiImage: image).resizable().scaledToFit()
                                .containerRelativeFrame(.horizontal)
                        }
                    } else if missing {
                        ContentUnavailableView("Page not on this phone", systemImage: "photo",
                                               description: Text("It may have been deleted from Photos."))
                    } else {
                        ProgressView()
                    }
                }
                .tag(index)
            }
        }
        .tabViewStyle(.page)
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .task { await load() }
    }

    private func load() async {
        guard await PhotoLibrary.requestAccess() else { missing = true; return }
        for (index, id) in menu.pagePhotoIds.enumerated() {
            guard let photo = photos.first(where: { $0.id == id }),
                  let local = PhotoLibrary.localIdentifier(local: photo.localIdentifier, cloud: photo.cloudIdentifier),
                  let data = await PhotoLibrary.jpeg(localIdentifier: local, maxPixels: 2400),
                  let image = UIImage(data: data)
            else { missing = true; continue }
            images[index] = image
        }
    }
}
