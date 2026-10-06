import Photos
import UIKit

/// The iPhone Photos library: menu pages are saved to a "Tedmarks" album and referenced by
/// identifier (decision #8: references, never copies).
enum PhotoLibrary {
    struct SavedAsset: Sendable {
        var localIdentifier: String
        var cloudIdentifier: String?
        var pixelWidth: Int
        var pixelHeight: Int
    }

    static let albumTitle = "Tedmarks"

    /// Asks once for access (needed to save into the album and show pages again later).
    nonisolated static func requestAccess() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return status == .authorized || status == .limited
    }

    /// Saves JPEGs as new photos in the Tedmarks album, in order.
    nonisolated static func save(_ jpegs: [Data]) async throws -> [SavedAsset] {
        let placeholders = PlaceholderBox()
        try await PHPhotoLibrary.shared().performChanges {
            let album = fetchAlbum().map { PHAssetCollectionChangeRequest(for: $0) }
                ?? PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: albumTitle)
            var created: [PHObjectPlaceholder] = []
            for jpeg in jpegs {
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: jpeg, options: nil)
                if let placeholder = request.placeholderForCreatedAsset { created.append(placeholder) }
            }
            album?.addAssets(created as NSArray)
            placeholders.ids = created.map(\.localIdentifier)
        }
        let ids = placeholders.ids
        let cloud = cloudIdentifiers(for: ids)
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var sizes: [String: (Int, Int)] = [:]
        assets.enumerateObjects { asset, _, _ in sizes[asset.localIdentifier] = (asset.pixelWidth, asset.pixelHeight) }
        return ids.map { id in
            SavedAsset(localIdentifier: id, cloudIdentifier: cloud[id], pixelWidth: sizes[id]?.0 ?? 0, pixelHeight: sizes[id]?.1 ?? 0)
        }
    }

    /// Cloud identifiers survive a new phone; local ones don't.
    nonisolated static func cloudIdentifiers(for localIdentifiers: [String]) -> [String: String] {
        let mappings = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: localIdentifiers)
        return mappings.compactMapValues { result in try? result.get().stringValue }
    }

    /// This phone's id for a photo (via its cloud id when it was taken on another phone).
    nonisolated static func localIdentifier(local: String?, cloud: String?) -> String? {
        if let local, PHAsset.fetchAssets(withLocalIdentifiers: [local], options: nil).count > 0 { return local }
        guard let cloud else { return nil }
        let mapping = PHPhotoLibrary.shared().localIdentifierMappings(for: [PHCloudIdentifier(stringValue: cloud)])
        return mapping.values.first.flatMap { try? $0.get() }
    }

    /// A photo as JPEG, at most `maxPixels` on its long side (downloads from iCloud if needed).
    nonisolated static func jpeg(localIdentifier: String, maxPixels: CGFloat = 2000) async -> Data? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil).firstObject else { return nil }
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        let scale = min(1, maxPixels / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
        let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
        return await withCheckedContinuation { (continuation: CheckedContinuation<Data?, Never>) in
            PHImageManager.default().requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, _ in
                continuation.resume(returning: image?.jpegData(compressionQuality: 0.75))
            }
        }
    }

    nonisolated private static func fetchAlbum() -> PHAssetCollection? {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "title = %@", albumTitle)
        return PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: options).firstObject
    }
}

/// Carries the new assets' ids out of the change block.
private final class PlaceholderBox: @unchecked Sendable {
    var ids: [String] = []
}

/// Sizes a page for reading: at most 2000 px on the long side, JPEG.
func menuPageJPEG(_ image: UIImage, maxPixels: CGFloat = 2000) -> Data? {
    let longSide = max(image.size.width, image.size.height) * image.scale
    let scale = min(1, maxPixels / max(longSide, 1))
    guard scale < 1 else { return image.jpegData(compressionQuality: 0.75) }
    let size = CGSize(width: image.size.width * image.scale * scale, height: image.size.height * image.scale * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return resized.jpegData(compressionQuality: 0.75)
}
