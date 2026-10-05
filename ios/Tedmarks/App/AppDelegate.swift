import SwiftUI
import TedmarksKit
import UserNotifications

/// Handles the visit prompt notification (Figma 06/07).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        VisitPrompt.registerCategories()
        return true
    }

    /// Show the prompt even if the app happens to be open.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// A verdict button saves it and ends the visit; tapping the notification opens Wrap up.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let raw = response.notification.request.content.userInfo[VisitPrompt.visitIdKey] as? String,
              let visitId = UUID(uuidString: raw) else { return }
        let actionIdentifier = response.actionIdentifier
        if actionIdentifier == UNNotificationDefaultActionIdentifier {
            await MainActor.run { AppRouter.shared.request = .wrapUp(visitId: visitId) }
        } else {
            // Save the verdict and end the visit; finishes before returning so iOS doesn't suspend us mid-way.
            await Task { @MainActor in
                do {
                    try await VisitPrompt.handle(actionIdentifier: actionIdentifier, visitId: visitId, in: TedmarksStore.context)
                    ActionLog.record("Notification verdict \(actionIdentifier) saved")
                } catch {
                    ActionLog.record("Notification verdict failed: \(error.localizedDescription)")
                }
            }.value
        }
    }
}
