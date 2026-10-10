import SwiftData
import SwiftUI
import TedmarksKit

enum AppTab: Hashable { case visit, visits, places, more }

/// Tab bar: Visit · Visits · Places · More (the Inbox lives in More, with the settings).
struct RootTabView: View {
    @State private var selectedTab: AppTab = .visit
    @Query(filter: #Predicate<Draft> { $0.statusRaw == "pending" && $0.deletedAt == nil }) private var pendingDrafts: [Draft]
    @Query(filter: #Predicate<VoiceNote> { $0.draftId == nil && $0.deletedAt == nil }) private var unprocessedNotes: [VoiceNote]

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Visit", systemImage: "fork.knife", value: .visit) {
                VisitHomeView()
            }
            Tab("Visits", systemImage: "clock.arrow.circlepath", value: .visits) {
                NavigationStack { PastVisitsView() }
            }
            Tab("Places", systemImage: "map", value: .places) { PlacesView() }
            Tab("More", systemImage: "ellipsis.circle", value: .more) { SettingsView() }
                .badge(pendingDrafts.count + unprocessedNotes.count)
        }
        #if DEBUG
        // Dev/testing: `simctl launch … -openSettings` / `-openInbox` (More) / `-openPlaces` / `-openPlace <name>` /
        // `-openPastVisits` (Visits) skip taps.
        .onAppear {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-openSettings") || arguments.contains("-openInbox") { selectedTab = .more }
            if arguments.contains("-openPastVisits") { selectedTab = .visits }
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
