import Photos
import SwiftData
import SwiftUI
import TedmarksKit

/// The latest menu's pages, from Photos, swipeable.
struct MenuPagesView: View {
    let menu: PlaceMenu

    @Environment(\.dismiss) private var dismiss
    @Query private var photos: [Photo]
    @State private var images: [Int: UIImage] = [:]
    @State private var missing = false

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Menu · \(menu.capturedAt.formatted(date: .abbreviated, time: .omitted))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
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
