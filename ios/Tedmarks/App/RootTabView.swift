import SwiftUI

enum AppTab: Hashable { case visit, inbox, places, settings }

/// Tab bar from the Figma designs (10 · Inbox): Visit · Inbox · Places · Settings.
struct RootTabView: View {
    @State private var selectedTab: AppTab = .visit

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Visit", systemImage: "fork.knife", value: .visit) {
                VisitHomeView()
            }
            Tab("Inbox", systemImage: "tray", value: .inbox) { InboxView() }
            Tab("Places", systemImage: "map", value: .places) { PlacesView() }
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
        }
        #if DEBUG
        // Dev/testing: `simctl launch … -openSettings` / `-openPlaces` / `-openPlace <name>` skip taps.
        .onAppear {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-openSettings") { selectedTab = .settings }
            if arguments.contains("-openPlaces") || arguments.contains("-openPlace") { selectedTab = .places }
        }
        #endif
        // Deep links from the Lock Screen widget (01), Live Activity (03) and notifications (06).
        .onOpenURL { url in AppRouter.shared.handle(url) }
        .onChange(of: AppRouter.shared.request) { _, request in
            guard let request else { return }
            selectedTab = .visit
            // The Visit tab is the start screen when no visit is in progress, otherwise the current visit.
            if request == .startVisit || request == .currentVisit { AppRouter.shared.request = nil }
            // rate-dish / wrap-up are opened by VisitHomeView.
        }
    }
}

#Preview { RootTabView() }
