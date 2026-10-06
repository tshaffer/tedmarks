import SwiftData
import SwiftUI
import TedmarksKit

enum AppTab: Hashable { case visit, inbox, places, settings }

/// Tab bar from the Figma designs (10 · Inbox): Visit · Inbox · Places · Settings.
struct RootTabView: View {
    @State private var selectedTab: AppTab = .visit
    @Query(filter: #Predicate<Draft> { $0.statusRaw == "pending" && $0.deletedAt == nil }) private var pendingDrafts: [Draft]
    @Query(filter: #Predicate<VoiceNote> { $0.draftId == nil && $0.deletedAt == nil }) private var unprocessedNotes: [VoiceNote]

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Visit", systemImage: "fork.knife", value: .visit) {
                VisitHomeView()
            }
            Tab("Inbox", systemImage: "tray", value: .inbox) { InboxView() }
                .badge(pendingDrafts.count + unprocessedNotes.count)
            Tab("Places", systemImage: "map", value: .places) { PlacesView() }
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
        }
        #if DEBUG
        // Dev/testing: `simctl launch … -openSettings` / `-openPlaces` / `-openPlace <name>` / `-openInbox` skip taps.
        .onAppear {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-openSettings") { selectedTab = .settings }
            if arguments.contains("-openPlaces") || arguments.contains("-openPlace") { selectedTab = .places }
            if arguments.contains("-openInbox") { selectedTab = .inbox }
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
