import AppIntents
import Foundation
import SwiftData
import TedmarksKit

// Compiled into BOTH the app and the widget extension (Apple's recommended setup for
// Live Activity buttons): the widget renders Button(intent:), and iOS runs perform()
// in the app's process.

/// 😍 / 👍 / 👎 on the Live Activity: rates the dish ("Us") without opening the app.
struct RateDishIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Rate a dish"
    static let isDiscoverable = false

    @Parameter(title: "Dish") var visitItemId: String
    @Parameter(title: "Rating") var rating: String

    init() {}

    init(visitItemId: String, rating: ItemRatingValue) {
        self.visitItemId = visitItemId
        self.rating = rating.rawValue
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        ActionLog.record("Rate dish tapped (\(rating))")
        let context = TedmarksStore.context
        guard let id = UUID(uuidString: visitItemId), let value = ItemRatingValue(rawValue: rating),
              let item = try context.fetch(FetchDescriptor<VisitItem>(predicate: #Predicate { $0.id == id })).first
        else {
            ActionLog.record("Rate dish \(rating): dish not found")
            return .result()
        }
        do {
            try DishCapture.rate(item, value, for: .us, enteredBy: try VisitStarter.devicePerson(in: context)?.id, in: context)
            await VisitSideEffects.reconcileNow(in: context)   // update the Live Activity before iOS suspends us
            ActionLog.record("Rated \(item.displayName) \(value.emoji)")
        } catch {
            ActionLog.record("Rate dish failed: \(error.localizedDescription)")
            throw error
        }
        return .result()
    }
}

/// 👎 / 👌 / 👍 on the Live Activity once every dish is rated: sets the visit verdict ("Us")
/// and ends the visit — same as answering the notification. The Live Activity goes away.
struct SetVerdictIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Would you come back?"
    static let isDiscoverable = false

    @Parameter(title: "Visit") var visitId: String
    @Parameter(title: "Verdict") var verdict: String

    init() {}

    init(visitId: String, verdict: VerdictValue) {
        self.visitId = visitId
        self.verdict = verdict.rawValue
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        ActionLog.record("Verdict tapped (\(verdict))")
        let context = TedmarksStore.context
        guard let id = UUID(uuidString: visitId), let value = VerdictValue(rawValue: verdict),
              let visit = try context.fetch(FetchDescriptor<Visit>(predicate: #Predicate { $0.id == id })).first
        else {
            ActionLog.record("Verdict \(verdict): visit not found")
            return .result()
        }
        do {
            try DishCapture.setVerdict(visit, value, for: .us, enteredBy: try VisitStarter.devicePerson(in: context)?.id, in: context)
            if visit.status == .inProgress {
                visit.wrapUpCompletedAt = .now
                try VisitStarter.endVisit(visit, in: context)
            }
            await VisitSideEffects.reconcileNow(in: context)
            ActionLog.record("Verdict \(value.emoji) saved, visit ended")
        } catch {
            ActionLog.record("Verdict failed: \(error.localizedDescription)")
            throw error
        }
        return .result()
    }
}
