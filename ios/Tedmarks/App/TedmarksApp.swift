import AppIntents
import SwiftData
import SwiftUI
import TedmarksKit

@main
struct TedmarksApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    init() {
        MainActor.assumeIsolated {
            #if DEBUG
            ActionLog.record("App launched (\(UIApplication.shared.applicationState == .background ? "background" : "foreground"))")
            DebugDemoData.seedIfRequested(in: TedmarksStore.context)
            DebugDemoData.seedPastVisitsIfRequested(in: TedmarksStore.context)
            DebugPromptLog.logIfRequested()
            #endif
        }
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
        .modelContainer(TedmarksStore.container)
        .onChange(of: scenePhase) { _, phase in
            // Catch up the Live Activity and prompt (e.g. after changes made elsewhere).
            if phase == .active { VisitSideEffects.reconcile(in: TedmarksStore.context) }
        }
    }
}
