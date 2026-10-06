import SwiftData
import SwiftUI
import TedmarksKit

/// The restaurant's latest menu: the dishes Claude read (by section, with prices and how we
/// rated the ones we've had) and, when they were saved, the page photos.
struct MenuSheet: View {
    let menu: PlaceMenu
    let place: Place

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .dishes

    enum Tab { case dishes, pages }

    var body: some View {
        NavigationStack {
            Group {
                switch tab {
                case .dishes: MenuDishesList(menu: menu, place: place)
                case .pages: MenuPagesContent(menu: menu)
                }
            }
            .navigationTitle("Menu · \(menu.capturedAt.formatted(date: .abbreviated, time: .omitted))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !menu.pagePhotoIds.isEmpty {
                    ToolbarItem(placement: .principal) {
                        Picker("Show", selection: $tab) {
                            Text("Dishes").tag(Tab.dishes)
                            Text("Photos").tag(Tab.pages)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 200)
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

/// The dishes read from the menu, in menu order, with our latest rating where we've had them.
private struct MenuDishesList: View {
    let menu: PlaceMenu
    let place: Place

    @Environment(\.modelContext) private var context

    var body: some View {
        let sections = Self.sections(menu.extracted ?? [])
        let ratings = latestRatings()
        List {
            if sections.isEmpty {
                Text(menu.readStatus == .read ? "No dishes were found on this menu." : "This menu hasn't been read yet.")
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                Section(section.title ?? "Menu") {
                    ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline) {
                            Text(item.name)
                            if let badge = ratings[normalizeItemName(item.name)] {
                                Text(badge).font(.subheadline)
                            }
                            Spacer()
                            if let price = item.price {
                                Text(price).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                    }
                }
            }
        }
    }

    private static func sections(_ items: [MenuItem]) -> [(title: String?, items: [MenuItem])] {
        var sections: [(title: String?, items: [MenuItem])] = []
        for item in items {
            if let last = sections.last, last.title == item.section {
                sections[sections.count - 1].items.append(item)
            } else {
                sections.append((item.section, [item]))
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
