import PhotosUI
import SwiftData
import SwiftUI
import TedmarksKit

/// The menu row on "What did you order?": snap or pick the menu, show that it's being read,
/// or offer to try again / snap new pages.
struct MenuPanel: View {
    let place: Place
    let visit: Visit?

    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<PlaceMenu> { $0.deletedAt == nil }, sort: \PlaceMenu.capturedAt, order: .reverse)
    private var menus: [PlaceMenu]

    @State private var showingCamera = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    private var capture: MenuCapture { MenuCapture.shared }

    var body: some View {
        Group {
            if let menu = latestMenu {
                status(menu)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    buttons(primary: true)
                    Text("Claude reads the dishes so you can just tap what you ordered.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            DocumentCamera { pages in
                showingCamera = false
                guard !pages.isEmpty else { return }
                Task { await capture.capture(pages: pages, place: place, visit: visit, in: context) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickedPhotos) { _, items in
            let ids = items.compactMap(\.itemIdentifier)
            pickedPhotos = []
            guard !ids.isEmpty else { return }
            Task { await capture.useExisting(localIdentifiers: ids, place: place, visit: visit, in: context) }
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

    private var latestMenu: PlaceMenu? { menus.first { $0.placeId == place.id } }

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
                    buttons(primary: false)
                }
            case .read:
                HStack(spacing: 6) {
                    Text("Menu from \(menu.capturedAt.formatted(date: .abbreviated, time: .omitted))")
                        .font(.footnote).foregroundStyle(.secondary)
                    Spacer()
                    Menu("Snap new pages") {
                        cameraButton
                        photosButton
                    }
                    .font(.footnote)
                }
            }
        }
    }

    private func buttons(primary: Bool) -> some View {
        // Side by side when there's room (Add dish), stacked in narrower lists (Place page).
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { buttonPair(primary: primary) }
            VStack(alignment: .leading, spacing: 8) { buttonPair(primary: primary) }
        }
        .controlSize(.regular)
    }

    @ViewBuilder
    private func buttonPair(primary: Bool) -> some View {
        cameraButton
            .buttonStyle(.borderedProminent)
            .tint(primary ? .accentColor : .secondary)
            .fixedSize()
        photosButton
            .buttonStyle(.bordered)
            .fixedSize()
    }

    private var cameraButton: some View {
        Button {
            if DocumentCamera.isAvailable {
                showingCamera = true
            } else {
                capture.message = "The camera isn't available here. Choose photos of the menu instead."
            }
        } label: {
            Label("Snap the menu", systemImage: "camera.viewfinder")
        }
    }

    private var photosButton: some View {
        PhotosPicker(selection: $pickedPhotos, maxSelectionCount: 12, matching: .images, photoLibrary: .shared()) {
            Label("From Photos", systemImage: "photo.on.rectangle")
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
