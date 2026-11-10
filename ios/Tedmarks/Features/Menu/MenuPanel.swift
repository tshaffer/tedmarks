import SwiftData
import SwiftUI
import TedmarksKit

/// The menu row on "What did you order?" (and the Place page before there's a menu): add the
/// menu's pages, show that it's being read, or offer to try again / add pages.
struct MenuPanel: View {
    let place: Place
    let visit: Visit?

    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<PlaceMenu> { $0.deletedAt == nil }, sort: \PlaceMenu.capturedAt, order: .reverse)
    private var menus: [PlaceMenu]

    private var capture: MenuCapture { MenuCapture.shared }

    var body: some View {
        Group {
            if let menu = latestMenu {
                status(menu)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    MenuPageSources(place: place, visit: visit, style: .firstMenu(primary: true))
                    Text("Claude reads the dishes so you can just tap what you ordered.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        #if DEBUG
        .task {
            if latestMenu == nil, let path = UserDefaults.standard.string(forKey: "menuImage") {
                await capture.debugRead(files: [path], place: place, visit: visit, in: context)
            }
        }
        #endif
        .alert("Menu", isPresented: .constant(capture.message != nil)) {
            Button("OK") { capture.message = nil }
        } message: { Text(capture.message ?? "") }
    }

    private var latestMenu: PlaceMenu? {
        let mine = menus.filter { $0.placeId == place.id }
        return mine.first { $0.id == place.latestMenuId } ?? mine.first
    }

    @ViewBuilder
    private func status(_ menu: PlaceMenu) -> some View {
        if capture.reading.contains(menu.id) {
            Label {
                Text("Reading the menu… you can keep going.")
            } icon: {
                ProgressView()
            }
            .font(.subheadline)
        } else {
            switch menu.readStatus {
            case .pending:
                HStack {
                    Label("Menu not read yet", systemImage: "doc.text.magnifyingglass").font(.subheadline)
                    Spacer()
                    Button("Try again") { Task { await capture.retry(menu, place: place, in: context) } }
                        .buttonStyle(.bordered).controlSize(.small)
                }
            case .failed:
                VStack(alignment: .leading, spacing: 8) {
                    Label("Couldn't read the menu", systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(.orange)
                    MenuPageSources(place: place, visit: visit, style: .firstMenu(primary: false))
                }
            case .read:
                HStack(spacing: 6) {
                    Text("Menu from \(menu.capturedAt.formatted(date: .abbreviated, time: .omitted))")
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    MenuPageSources(place: place, visit: visit, style: .addPages)
                        .font(.footnote)
                }
            }
        }
    }
}

/// "On the menu" chips (or rows), grouped by the menu's sections. `exclude` hides dishes shown elsewhere.
struct MenuChipSections<Chip: View>: View {
    let place: Place
    let exclude: Set<UUID>
    let filter: String
    var asRows = false
    @ViewBuilder let chip: (PlaceItem) -> Chip

    @Environment(\.modelContext) private var context
    // Re-render when a menu is read.
    @Query(filter: #Predicate<PlaceMenu> { $0.deletedAt == nil }) private var menus: [PlaceMenu]

    var body: some View {
        let _ = menus.count
        let query = normalizeItemName(filter)
        let sections = ((try? MenuReading.sections(for: place, in: context)) ?? []).compactMap { section -> (title: String?, items: [PlaceItem])? in
            let items = section.items.filter { !exclude.contains($0.id) && (query.isEmpty || $0.normalizedName.contains(query)) }
            return items.isEmpty ? nil : (section.title, items)
        }
        ForEach(Array(sections.enumerated()), id: \.offset) { index, section in
            VStack(alignment: .leading, spacing: 8) {
                Text((index == 0 ? "On the menu · " : "") + (section.title ?? "Other"))
                    .textCase(.uppercase)
                    .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                if asRows {
                    VStack(spacing: 0) { ForEach(section.items) { chip($0) } }
                } else {
                    FlowLayout(spacing: 8) {
                        ForEach(section.items) { chip($0) }
                    }
                }
            }
        }
    }
}
