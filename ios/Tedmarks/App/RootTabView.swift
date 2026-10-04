import SwiftUI

/// Tab bar from the Figma designs (10 · Inbox): Visit · Inbox · Places · Settings.
struct RootTabView: View {
    var body: some View {
        TabView {
            Tab("Visit", systemImage: "fork.knife") { VisitHomeView() }
            Tab("Inbox", systemImage: "tray") { InboxView() }
            Tab("Places", systemImage: "map") { PlacesView() }
            Tab("Settings", systemImage: "gearshape") { SettingsView() }
        }
    }
}

#Preview { RootTabView() }
