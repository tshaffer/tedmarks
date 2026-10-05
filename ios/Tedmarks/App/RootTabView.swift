import SwiftUI

enum AppTab: Hashable { case visit, inbox, places, settings }

/// Tab bar from the Figma designs (10 · Inbox): Visit · Inbox · Places · Settings.
struct RootTabView: View {
    @State private var selectedTab: AppTab = .visit
    @State private var showStartVisit = false

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Visit", systemImage: "fork.knife", value: .visit) {
                VisitHomeView(showStartVisit: $showStartVisit)
            }
            Tab("Inbox", systemImage: "tray", value: .inbox) { InboxView() }
            Tab("Places", systemImage: "map", value: .places) { PlacesView() }
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
        }
        #if DEBUG
        // Dev/testing: `simctl launch … -openStartVisit` / `-openSettings` skip a tap.
        .onAppear {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-openStartVisit") { showStartVisit = true }
            if arguments.contains("-openSettings") { selectedTab = .settings }
        }
        #endif
        // Deep links from the Lock Screen widget (01), Live Activity (03) and notifications (06).
        .onOpenURL { url in AppRouter.shared.handle(url) }
        .onChange(of: AppRouter.shared.request) { _, request in
            guard let request else { return }
            selectedTab = .visit
            if request == .startVisit {
                showStartVisit = true
                AppRouter.shared.request = nil
            }
            // rate-dish / wrap-up are opened by VisitHomeView.
        }
    }
}

#Preview { RootTabView() }
