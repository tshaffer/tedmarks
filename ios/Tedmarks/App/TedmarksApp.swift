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
            SyncEngine.shared.configure(transport: AppConfig.api, context: TedmarksStore.context)
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
            switch phase {
            case .active:
                // Catch up the Live Activity and prompt (e.g. after Lock Screen taps), and sync.
                VisitSideEffects.reconcile(in: TedmarksStore.context)
                Task { await SyncEngine.shared.sync() }
            case .background:
                syncBeforeSuspending()
            default:
                break
            }
        }
    }

    /// Leaving the app: finish sending what was just captured (iOS allows ~30 seconds).
    private func syncBeforeSuspending() {
        let application = UIApplication.shared
        var taskId = UIBackgroundTaskIdentifier.invalid
        taskId = application.beginBackgroundTask(withName: "Sync") { application.endBackgroundTask(taskId) }
        Task {
            await SyncEngine.shared.sync()
            application.endBackgroundTask(taskId)
        }
    }
}
