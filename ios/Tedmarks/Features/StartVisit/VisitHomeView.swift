import SwiftUI

/// Home of the Visit tab: the big "Start visit" entry point (Figma 02) and the
/// current visit when one is active. Placeholder until the capture loop is built.
struct VisitHomeView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Start a visit",
                systemImage: "fork.knife.circle",
                description: Text("Nearby restaurants will appear here.")
            )
            .navigationTitle("Visit")
        }
    }
}
