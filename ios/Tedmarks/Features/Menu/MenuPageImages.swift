import Network
import Observation
import PDFKit
import SwiftUI
import TedmarksKit

/// Whether the phone can reach the internet, for "New pages will appear when you're back online."
@MainActor
@Observable
final class Connectivity {
    static let shared = Connectivity()
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            Task { @MainActor in Connectivity.shared.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "Connectivity"))
    }
}

/// Menu pages as pictures: an image, or each page of a PDF. Kept on the phone once fetched
/// (MenuPageCache); drawn pictures are kept in memory while the app runs.
@MainActor
enum MenuPageImages {
    private static let drawn = NSCache<NSString, NSArray>()

    /// The page's pictures (a PDF has several), at most `maxSide` pixels on the long side.
    static func images(for page: MenuPageRef, maxSide: CGFloat) async throws -> [UIImage] {
        let key = "\(page.id.uuidString)-\(Int(maxSide))" as NSString
        if let images = drawn.object(forKey: key) as? [UIImage] { return images }
        let data = try await MenuPageCache.shared.data(for: page.id, using: AppConfig.api)
        let images: [UIImage]
        if page.isPDF {
            guard let document = PDFDocument(data: data) else { throw MenuFileError.unreadable("The PDF") }
            images = (0..<document.pageCount).compactMap { document.page(at: $0).flatMap { MenuFiles.render($0, maxSide: maxSide) } }
        } else {
            guard let image = UIImage(data: data) else { throw MenuFileError.unreadable("The page") }
            images = [maxSide < 1000 ? image.preparingThumbnail(of: thumbSize(image.size, maxSide)) ?? image : image]
        }
        drawn.setObject(images as NSArray, forKey: key)
        return images
    }

    private static func thumbSize(_ size: CGSize, _ maxSide: CGFloat) -> CGSize {
        let scale = min(1, maxSide / max(size.width, size.height, 1))
        return CGSize(width: size.width * scale, height: size.height * scale)
    }
}

/// A page's small picture (the first page of a PDF), for the Place page's strip.
struct MenuPageThumb: View {
    let page: MenuPageRef
    var width: CGFloat = 64

    @State private var image: UIImage?
    @State private var unavailable = false

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Color(red: 0.98, green: 0.96, blue: 0.92))
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if unavailable {
                    Image(systemName: page.isPDF ? "doc.richtext" : "photo").foregroundStyle(.secondary)
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(width: width, height: width * 4 / 3, alignment: .top)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(red: 0.89, green: 0.84, blue: 0.75)))
            .overlay(alignment: .bottomTrailing) {
                if page.isPDF {
                    Text("PDF").font(.system(size: 9, weight: .bold)).padding(.horizontal, 4).padding(.vertical, 1)
                        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 3)).foregroundStyle(.white).padding(3)
                }
            }
            .task(id: page.id) {
                do { image = try await MenuPageImages.images(for: page, maxSide: 300).first } catch { unavailable = true }
            }
    }
}

/// Pinch or double-tap to zoom a page.
struct ZoomablePage: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.delegate = context.coordinator
        scroll.showsHorizontalScrollIndicator = false
        scroll.backgroundColor = .clear
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.imageView = view
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        tap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(tap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var imageView: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
        @objc func doubleTap(_ tap: UITapGestureRecognizer) {
            guard let scroll = tap.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 {
                scroll.setZoomScale(1, animated: true)
            } else {
                let point = tap.location(in: imageView)
                scroll.zoom(to: CGRect(x: point.x - 60, y: point.y - 80, width: 120, height: 160), animated: true)
            }
        }
    }
}

/// Figma 12b · the menu's pages, swipeable and zoomable; a PDF spreads out into its pages.
struct MenuServerPages: View {
    let pages: [MenuPageRef]
    var start = 0

    @State private var images: [UUID: [UIImage]] = [:]
    @State private var failed: Set<UUID> = []
    @State private var selection = 0
    private var connectivity: Connectivity { Connectivity.shared }

    private struct Shown: Identifiable {
        let id: String
        let image: UIImage?
        let failed: Bool
    }

    private var shown: [Shown] {
        pages.flatMap { page -> [Shown] in
            if let list = images[page.id] {
                return list.enumerated().map { Shown(id: "\(page.id)#\($0.offset)", image: $0.element, failed: false) }
            }
            return [Shown(id: page.id.uuidString, image: nil, failed: failed.contains(page.id))]
        }
    }

    var body: some View {
        let shown = shown
        TabView(selection: $selection) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, page in
                Group {
                    if let image = page.image {
                        ZoomablePage(image: image)
                    } else if page.failed {
                        ContentUnavailableView("Page not on this phone yet", systemImage: "icloud.slash",
                                               description: Text(connectivity.isOnline ? "It couldn’t be fetched. Try again later." : "New pages will appear when you're back online."))
                    } else {
                        ProgressView()
                    }
                }
                .tag(index)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(Color(white: 0.92))
        .safeAreaInset(edge: .bottom) {
            if shown.count > 1 {
                Text("Page \(min(selection, shown.count - 1) + 1) of \(shown.count)")
                    .font(.footnote).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule()).padding(.bottom, 8)
            }
        }
        .task(id: connectivity.isOnline) { await load() }
        .onAppear { selection = start }
    }

    private func load() async {
        for page in pages where images[page.id] == nil {
            do {
                images[page.id] = try await MenuPageImages.images(for: page, maxSide: 2400)
                failed.remove(page.id)
            } catch {
                failed.insert(page.id)
            }
        }
    }
}
