import PhotosUI
import SwiftData
import SwiftUI
import TedmarksKit
import UniformTypeIdentifiers

/// Where new menu pages come from (Figma 12d): the camera, Photos, or a PDF or file — added to
/// the menu, or replacing all its pages.
struct MenuPageSources: View {
    enum Style {
        /// No menu yet: "Snap the menu" and "From Photos", side by side or stacked.
        case firstMenu(primary: Bool)
        /// An "Add pages" menu, with Replace all pages….
        case addPages
    }

    let place: Place
    let visit: Visit?
    let style: Style

    @Environment(\.modelContext) private var context
    @State private var replacing = false
    @State private var confirmingReplace = false
    @State private var showingCamera = false
    @State private var showingPhotos = false
    @State private var showingFiles = false
    @State private var picked: [PhotosPickerItem] = []
    private var capture: MenuCapture { MenuCapture.shared }

    var body: some View {
        content
            .fullScreenCover(isPresented: $showingCamera) {
                DocumentCamera { images in
                    showingCamera = false
                    add(images.compactMap(MenuFiles.photo))
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $showingPhotos, selection: $picked, maxSelectionCount: 12, matching: .images, photoLibrary: .shared())
            .onChange(of: picked) { _, items in
                guard !items.isEmpty else { return }
                picked = []
                Task { await addFromPhotos(items) }
            }
            .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.pdf, .png, .jpeg, .heic, .image], allowsMultipleSelection: true) { result in
                addFiles(result)
            }
            .confirmationDialog("Replace all pages?", isPresented: $confirmingReplace, titleVisibility: .visible) {
                Button("Take photos") { start(.camera, replace: true) }
                Button("Choose from Photos") { start(.photos, replace: true) }
                Button("Choose a PDF or file") { start(.files, replace: true) }
            } message: {
                Text("The menu’s pages are deleted and the new ones are read as a new menu. Dishes you’ve had stay on the place.")
            }
    }

    @ViewBuilder
    private var content: some View {
        switch style {
        case .firstMenu(let primary):
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { firstButtons(primary: primary) }
                VStack(alignment: .leading, spacing: 8) { firstButtons(primary: primary) }
            }
            .controlSize(.regular)
        case .addPages:
            Menu {
                sourceButtons(replace: false)
                Divider()
                Button(role: .destructive) { confirmingReplace = true } label: {
                    Label("Replace all pages…", systemImage: "arrow.triangle.2.circlepath")
                }
            } label: {
                Label("Add pages", systemImage: "plus.rectangle.on.rectangle")
            }
        }
    }

    @ViewBuilder
    private func firstButtons(primary: Bool) -> some View {
        Button { start(.camera, replace: false) } label: { MenuButtonLabel(title: "Snap the menu", systemImage: "camera.viewfinder") }
            .buttonStyle(.borderedProminent)
            .tint(primary ? .accentColor : .secondary)
            .fixedSize()
        Menu {
            Button { start(.photos, replace: false) } label: { Label("Choose from Photos", systemImage: "photo.on.rectangle") }
            Button { start(.files, replace: false) } label: { Label("Choose a PDF or file", systemImage: "doc") }
        } label: {
            MenuButtonLabel(title: "Photos or a PDF", systemImage: "photo.on.rectangle")
        }
        .buttonStyle(.bordered)
        .fixedSize()
    }

    @ViewBuilder
    private func sourceButtons(replace: Bool) -> some View {
        Button { start(.camera, replace: replace) } label: { Label("Take photos", systemImage: "camera.viewfinder") }
        Button { start(.photos, replace: replace) } label: { Label("Choose from Photos", systemImage: "photo.on.rectangle") }
        Button { start(.files, replace: replace) } label: { Label("Choose a PDF or file", systemImage: "doc") }
    }

    private enum Source { case camera, photos, files }

    private func start(_ source: Source, replace: Bool) {
        replacing = replace
        switch source {
        case .camera:
            if DocumentCamera.isAvailable { showingCamera = true } else { capture.message = "The camera isn’t available here. Choose photos or a PDF instead." }
        case .photos: showingPhotos = true
        case .files: showingFiles = true
        }
    }

    private func add(_ pages: [PreparedMenuPage]) {
        guard !pages.isEmpty else { return }
        let replace = replacing
        Task { await capture.add(pages, place: place, visit: visit, replace: replace, in: context) }
    }

    /// Library photos as they are: a screenshot stays a PNG, a photo becomes a JPEG.
    private func addFromPhotos(_ items: [PhotosPickerItem]) async {
        var pages: [PreparedMenuPage] = []
        for (index, item) in items.enumerated() {
            let type = item.supportedContentTypes.first { $0.conforms(to: .png) } ?? item.supportedContentTypes.first
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let page = try? MenuFiles.file(data, type: type, name: "Photo \(index + 1)")
            else { continue }
            pages.append(page)
        }
        if pages.isEmpty { capture.message = "Couldn’t open those photos." }
        add(pages)
    }

    private func addFiles(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        var pages: [PreparedMenuPage] = []
        do {
            for url in urls.prefix(12) {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                let type = (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType
                pages.append(try MenuFiles.file(data, type: type, name: url.lastPathComponent))
            }
        } catch {
            capture.message = error.localizedDescription
            return
        }
        add(pages)
    }
}

/// Image + Text (not Label), which newer iOS versions can collapse inside a List.
struct MenuButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
            Text(title).lineLimit(1)
        }
    }
}
