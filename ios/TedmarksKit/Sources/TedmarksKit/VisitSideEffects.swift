import Foundation
import SwiftData
import UserNotifications
#if os(iOS)
import ActivityKit
#endif

/// Keeps the Live Activity (Figma 03) and the one time-based prompt (Figma 06/07) in step
/// with the data. Called after every change to a visit, its dishes or ratings; idempotent.
@MainActor
public enum VisitSideEffects {

    public static func reconcile(in context: ModelContext) {
        SyncEngine.shared.scheduleSync()   // no-op where sync isn't configured (widget extension)
        #if os(iOS)
        let work = plannedWork(in: context)
        Task { await perform(work) }
        #endif
    }

    /// Same as reconcile, but finishes before returning — for Live Activity buttons and
    /// notification actions, where iOS may suspend the app as soon as the action returns.
    public static func reconcileNow(in context: ModelContext) async {
        SyncEngine.shared.scheduleSync()
        #if os(iOS)
        await perform(plannedWork(in: context))
        #endif
    }

    #if os(iOS)
    private struct Work: Sendable {
        var activities: [(attributes: VisitActivityAttributes, content: VisitActivityContent)]
        var prompts: [VisitPrompt.Plan]
    }

    private static func plannedWork(in context: ModelContext) -> Work {
        let active = (try? VisitStarter.activeVisits(in: context)) ?? []
        let people = (try? context.fetch(FetchDescriptor<Person>())) ?? []
        let names = Dictionary(uniqueKeysWithValues: people.map { ($0.id, $0.displayName) })
        return Work(
            activities: active.map { visit in
                (
                    VisitActivityAttributes(
                        visitId: visit.id.uuidString,
                        placeName: visit.place?.name ?? "Visit",
                        participants: ListFormatter.localizedString(byJoining: visit.participantIds.compactMap { names[$0] }),
                        startedAt: visit.startedAt
                    ),
                    content(for: visit, people: people, context: context)
                )
            },
            prompts: active.compactMap { promptPlan(for: $0, people: people, context: context) }
        )
    }

    private static func perform(_ work: Work) async {
        let wantedIds = Set(work.activities.map(\.attributes.visitId))
        for activity in Activity<VisitActivityAttributes>.activities where !wantedIds.contains(activity.attributes.visitId) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        for (attributes, content) in work.activities {
            let state = ActivityContent(state: content, staleDate: nil)
            var found = false
            for activity in Activity<VisitActivityAttributes>.activities where activity.attributes.visitId == attributes.visitId {
                found = true
                await activity.update(state)
            }
            if !found && ActivityAuthorizationInfo().areActivitiesEnabled {
                // Only possible while the app is in the foreground (i.e. when the visit starts).
                _ = try? Activity.request(attributes: attributes, content: state)
            }
        }
        await VisitPrompt.sync(plans: work.prompts)
    }
    #endif

    /// Live Activity content for a visit.
    public static func content(for visit: Visit, people: [Person], context: ModelContext) -> VisitActivityContent {
        let household = DishCapture.household(for: visit, people: people)
        let dishes = DishCapture.orderItems(for: visit).prefix(12).map { item in
            VisitActivityContent.Dish(id: item.id.uuidString, name: item.displayName, badge: badge(for: item, household: household, context: context))
        }
        let verdict = (try? DishCapture.verdict(for: visit, household: household, in: context)) ?? .none
        let verdictEmoji: String? = switch verdict {
        case .none: nil
        case .joint(let value): value.emoji
        case .split(let people): people.map(\.value.emoji).joined(separator: "/")
        }
        return VisitActivityContent(dishes: Array(dishes), ratedCount: dishes.filter { $0.badge != nil }.count, verdictEmoji: verdictEmoji)
    }

    private static func badge(for item: VisitItem, household: [UUID], context: ModelContext) -> String? {
        switch (try? DishCapture.display(for: item, household: household, in: context)) ?? .none {
        case .none: nil
        case .joint(let value): value.emoji
        case .split(let people): people.map(\.value.emoji).joined(separator: "/")
        }
    }

    // MARK: - Prompt

    private static func promptPlan(for visit: Visit, people: [Person], context: ModelContext) -> VisitPrompt.Plan? {
        let household = DishCapture.household(for: visit, people: people)
        let hasVerdict = ((try? DishCapture.verdict(for: visit, household: household, in: context)) ?? .none) != .none
        guard !hasVerdict else { return nil }
        let fireDate = visit.startedAt.addingTimeInterval(VisitPromptSettings.delaySeconds())
        guard fireDate > .now else { return nil }
        let rated = content(for: visit, people: people, context: context).ratedCount
        return VisitPrompt.Plan(visitId: visit.id, placeName: visit.place?.name ?? "your visit", fireDate: fireDate, ratedDishes: rated)
    }
}

/// The one "How was it?" notification (Figma 06/07).
public enum VisitPrompt {
    public static let categoryId = "VISIT_VERDICT"
    public static let visitIdKey = "visitId"
    private static let idPrefix = "visit-prompt-"

    public struct Plan: Sendable {
        public var visitId: UUID
        public var placeName: String
        public var fireDate: Date
        public var ratedDishes: Int
    }

    /// Notification actions: one tap saves the verdict and ends the visit, without opening the app.
    public static func registerCategories() {
        let actions = VerdictValue.allCases.reversed().map { value in
            UNNotificationAction(identifier: value.rawValue, title: "\(value.emoji)  \(label(value))", options: [])
        }
        let category = UNNotificationCategory(identifier: categoryId, actions: actions, intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    public static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    /// For testing on a phone: the same prompt for the active visit, in `seconds`.
    /// Returns a short status message.
    @MainActor
    public static func sendTest(in context: ModelContext, after seconds: TimeInterval = 10) async -> String {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined { await requestAuthorization() }
        guard await center.notificationSettings().authorizationStatus == .authorized else {
            return "Notifications are off for Tedmarks (Settings → Notifications)."
        }
        guard let visit = try? VisitStarter.activeVisits(in: context).first else { return "Start a visit first." }
        let content = UNMutableNotificationContent()
        content.title = "How was \(visit.place?.name ?? "your visit")?"
        content.body = "Test prompt. Press and hold to give a verdict — one tap is enough."
        content.categoryIdentifier = categoryId
        content.userInfo = [visitIdKey: visit.id.uuidString]
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "visit-prompt-test",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        )
        do {
            try await center.add(request)
            return "Test prompt in \(Int(seconds)) seconds — lock the phone to see it."
        } catch {
            return "Couldn't schedule: \(error.localizedDescription)"
        }
    }

    /// Makes pending prompts match the plans: adds/updates wanted ones, removes the rest.
    static func sync(plans: [Plan]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(idPrefix) }
        let wanted = Set(plans.map { idPrefix + $0.visitId.uuidString })
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { !wanted.contains($0) })
        for plan in plans {
            let content = UNMutableNotificationContent()
            content.title = plan.ratedDishes > 0 ? "How was \(plan.placeName) overall?" : "How was \(plan.placeName)?"
            content.body = plan.ratedDishes > 0
                ? "\(plan.ratedDishes) dish\(plan.ratedDishes == 1 ? "" : "es") rated. Press and hold to give a verdict — one tap is enough."
                : "Press and hold to give a verdict — one tap is enough."
            content.categoryIdentifier = categoryId
            content.userInfo = [visitIdKey: plan.visitId.uuidString]
            content.sound = .default
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: plan.fireDate)
            let request = UNNotificationRequest(
                identifier: idPrefix + plan.visitId.uuidString,
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            )
            try? await center.add(request)   // same identifier replaces, keeping the fire date
        }
    }

    /// A verdict action from the notification: save it ("Us") and end the visit.
    @MainActor
    public static func handle(actionIdentifier: String, visitId: UUID, in context: ModelContext) async throws {
        guard let value = VerdictValue(rawValue: actionIdentifier),
              let visit = try context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { $0.id == visitId })).first
        else { return }
        let me = try VisitStarter.devicePerson(in: context)?.id
        try DishCapture.setVerdict(visit, value, for: .us, enteredBy: me, in: context)
        if visit.status == .inProgress {
            visit.wrapUpCompletedAt = .now
            try VisitStarter.endVisit(visit, in: context)
        }
        await VisitSideEffects.reconcileNow(in: context)
    }

    private static func label(_ value: VerdictValue) -> String {
        switch value {
        case .wontReturn: "Won't return"
        case .tryAgain: "Try again"
        case .wouldReturn: "Would return"
        }
    }
}
