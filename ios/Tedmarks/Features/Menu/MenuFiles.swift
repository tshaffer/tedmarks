import PDFKit
import TedmarksKit
import UIKit
import UniformTypeIdentifiers

/// A page ready to keep (stored on the server as the menu's picture) and to read.
struct PreparedMenuPage {
    let id = UUID()
    let mediaType: String
    /// What's stored as the page.
    let data: Data
    var pixelWidth: Int?
    var pixelHeight: Int?
    /// What's sent to Claude for it (a big PDF goes as page images).
    let forReading: [TedmarksAPI.MenuReadPage]

    var ref: MenuPageRef { MenuPageRef(id: id, mediaType: mediaType, pixelWidth: pixelWidth, pixelHeight: pixelHeight) }
}

enum MenuFileError: LocalizedError {
    case unreadable(String)
    case tooBig(String)
    var errorDescription: String? {
        switch self {
        case .unreadable(let what): "\(what) couldn’t be opened."
        case .tooBig(let what): what
        }
    }
}

/// Like the website (web/src/menu/menuFiles.ts): photos are kept at most 3,000 pixels on the
/// long side, screenshots (PNG) and PDFs as they are; what's read is smaller when it must be.
enum MenuFiles {
    static let maxKeptSide: CGFloat = 3000
    static let maxReadImageBytes = 3_600_000
    static let maxReadSide: CGFloat = 7900
    static let maxPDFBytes = 15_000_000
    static let maxPDFPages = 30
    static let maxKeptBytes = 40_000_000

    /// A page from the camera.
    static func photo(_ image: UIImage) -> PreparedMenuPage? {
        guard let kept = jpeg(image, maxSide: maxKeptSide) else { return nil }
        return page(mediaType: "image/jpeg", data: kept.data, size: kept.size, image: image)
    }

    /// A chosen file or library photo.
    static func file(_ data: Data, type: UTType?, name: String) throws -> PreparedMenuPage {
        guard data.count <= maxKeptBytes else { throw MenuFileError.tooBig("\(name) is too big (40 MB at most).") }
        if type?.conforms(to: .pdf) == true || name.lowercased().hasSuffix(".pdf") {
            return try pdf(data, name: name)
        }
        guard let image = UIImage(data: data) else { throw MenuFileError.unreadable(name) }
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        if type?.conforms(to: .png) == true {
            return page(mediaType: "image/png", data: data, size: pixels, image: image)
        }
        if type?.conforms(to: .jpeg) == true, max(pixels.width, pixels.height) <= maxKeptSide {
            return page(mediaType: "image/jpeg", data: data, size: pixels, image: image)
        }
        guard let kept = jpeg(image, maxSide: maxKeptSide) else { throw MenuFileError.unreadable(name) }
        return page(mediaType: "image/jpeg", data: kept.data, size: kept.size, image: image)
    }

    private static func page(mediaType: String, data: Data, size: CGSize, image: UIImage) -> PreparedMenuPage {
        var read = TedmarksAPI.MenuReadPage(mediaType: mediaType, data: data)
        if data.count > maxReadImageBytes || max(size.width, size.height) > maxReadSide {
            var side = min(maxReadSide, max(size.width, size.height))
            repeat {
                if let smaller = jpeg(image, maxSide: side) { read = .init(mediaType: "image/jpeg", data: smaller.data) }
                side *= 0.75
            } while read.data.count > maxReadImageBytes && side >= 600
        }
        return PreparedMenuPage(mediaType: mediaType, data: data, pixelWidth: Int(size.width), pixelHeight: Int(size.height), forReading: [read])
    }

    private static func pdf(_ data: Data, name: String) throws -> PreparedMenuPage {
        guard let document = PDFDocument(data: data), document.pageCount > 0 else { throw MenuFileError.unreadable(name) }
        if data.count <= maxPDFBytes {
            return PreparedMenuPage(mediaType: "application/pdf", data: data, forReading: [.init(mediaType: "application/pdf", data: data)])
        }
        guard document.pageCount <= maxPDFPages else {
            throw MenuFileError.tooBig("\(name) has \(document.pageCount) pages; up to \(maxPDFPages) for a PDF this big.")
        }
        let pages = (0..<document.pageCount).compactMap { index -> TedmarksAPI.MenuReadPage? in
            guard let page = document.page(at: index), let image = render(page, maxSide: 2000), let jpeg = jpeg(image, maxSide: 2000) else { return nil }
            return .init(mediaType: "image/jpeg", data: jpeg.data)
        }
        return PreparedMenuPage(mediaType: "application/pdf", data: data, forReading: pages)
    }

    /// A PDF page drawn as an image, at most `maxSide` pixels on its long side.
    static func render(_ page: PDFPage, maxSide: CGFloat) -> UIImage? {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = min(4, maxSide / max(bounds.width, bounds.height))
        return page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
    }

    static func jpeg(_ image: UIImage, maxSide: CGFloat) -> (data: Data, size: CGSize)? {
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let scale = min(1, maxSide / max(pixels.width, pixels.height, 1))
        let size = CGSize(width: (pixels.width * scale).rounded(), height: (pixels.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()   // transparent screenshots read better on white
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return drawn.jpegData(compressionQuality: 0.85).map { ($0, size) }
    }
}
