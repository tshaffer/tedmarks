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
        // tedmarks://start-visit — from the Lock Screen widget (Figma 01).
        .onOpenURL { url in
            guard url.scheme == "tedmarks", url.host() == "start-visit" else { return }
            selectedTab = .visit
            showStartVisit = true
        }
    }
}

#Preview { RootTabView() }
