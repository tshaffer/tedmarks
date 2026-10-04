import SwiftUI

/// Saved places list/map; each opens the Place page (Figma 11).
struct PlacesView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("No places yet", systemImage: "map")
                .navigationTitle("Places")
        }
    }
}
