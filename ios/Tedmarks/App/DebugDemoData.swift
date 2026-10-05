#if DEBUG
import Foundation
import SwiftData
import TedmarksKit

/// Dev/testing only. `simctl launch … -demoVisit` creates an in-progress visit at Doppio Zero
/// with four dishes (one disagreement, one unrated) so screens can be checked without tapping.
@MainActor
enum DebugDemoData {
    static func seedIfRequested(in context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-demoVisit"),
              (try? VisitStarter.activeVisits(in: context))?.isEmpty ?? true,
              let people = try? context.fetch(FetchDescriptor<Person>()),
              let ted = people.first(where: { $0.displayName == "Ted" }),
              let lori = people.first(where: { $0.displayName == "Lori" })
        else { return }
        do {
            let doppio = NearbyPlace(
                googlePlaceId: "demo-doppio-zero", name: "Doppio Zero", address: "160 Castro St, Mountain View",
                latitude: 37.3944, longitude: -122.0788, primaryTypeLabel: "Italian Restaurant", distanceMeters: 30
            )
            let visit = try VisitStarter.startVisit(at: doppio, participantIds: [ted.id, lori.id], in: context)
            let rated: [(String, ItemRatingValue, RateFor)] = [
                ("Burrata", .loved, .us), ("Doppio Zero pizza", .good, .us), ("Arancini", .loved, .us),
            ]
            for (name, value, rateFor) in rated {
                if let item = try DishCapture.addItem(named: name, to: visit, addedVia: .order, in: context) {
                    try DishCapture.rate(item, value, for: rateFor, enteredBy: ted.id, in: context)
                }
            }
            if let arancini = DishCapture.orderItems(for: visit).first(where: { $0.displayName == "Arancini" }) {
                try DishCapture.rate(arancini, .skip, for: .person(ted.id), enteredBy: ted.id, in: context)
            }
            try DishCapture.addItem(named: "Funghi pizza", to: visit, addedVia: .order, in: context)
        } catch {
            print("Demo data failed: \(error)")
        }
    }

    /// `-demoPastVisits` ends any visit in progress and, if there are no past visits yet, adds
    /// three at different places and dates (for checking the Past visits sorts).
    static func seedPastVisitsIfRequested(in context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-demoPastVisits") else { return }
        do {
            for visit in try VisitStarter.activeVisits(in: context) { try VisitStarter.endVisit(visit, in: context) }
            let ended = VisitStatus.ended.rawValue
            let past = try context.fetchCount(FetchDescriptor<Visit>(predicate: #Predicate { $0.statusRaw == ended && $0.deletedAt == nil }))
            guard past < 2 else { return }
            let places: [(String, Double, Double, Double, VerdictValue)] = [
                ("Tamarine", 37.4446, -122.1617, 9, .wouldReturn),     // Palo Alto
                ("Bistro Vida", 37.4530, -122.1817, 30, .tryAgain),    // Menlo Park
                ("Alexander's Steakhouse", 37.3236, -122.0103, 2, .wontReturn), // Cupertino
            ]
            for (name, lat, lng, daysAgo, verdict) in places {
                let picked = NearbyPlace(googlePlaceId: "demo-\(name)", name: name, latitude: lat, longitude: lng, distanceMeters: 0)
                let visit = try VisitStarter.startVisit(at: picked, participantIds: [], in: context, now: .now.addingTimeInterval(-daysAgo * 86_400))
                try DishCapture.addItem(named: "House special", to: visit, addedVia: .order, in: context)
                try DishCapture.setVerdict(visit, verdict, for: .us, enteredBy: nil, in: context)
                try VisitStarter.endVisit(visit, in: context)
            }
        } catch {
            print("Demo past visits failed: \(error)")
        }
    }
}
#endif

#if DEBUG
import SwiftUI
import UserNotifications

/// Dev/testing: `-previewLiveActivity` shows the Lock Screen Live Activity view for the active
/// visit inside the app (the simulator can't be locked from a script).
struct DebugLiveActivityPreview: View {
    let visit: Visit
    let people: [Person]
    @Environment(\.modelContext) private var context

    var body: some View {
        let attributes = VisitActivityAttributes(
            visitId: visit.id.uuidString, placeName: visit.place?.name ?? "Visit",
            participants: "Ted and Lori", startedAt: visit.startedAt
        )
        VStack(spacing: 24) {
            Text("Lock Screen Live Activity (debug preview)").font(.caption).foregroundStyle(.secondary)
            LockScreenVisitView(attributes: attributes, state: VisitSideEffects.content(for: visit, people: people, context: context))
                .padding(16)
                .background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 24))
            Text("…and once every dish is rated").font(.caption).foregroundStyle(.secondary)
            LockScreenVisitView(attributes: attributes, state: VisitActivityContent(
                dishes: [.init(id: "1", name: "Burrata", badge: "😍"), .init(id: "2", name: "Pizza", badge: "👍")],
                ratedCount: 2, verdictEmoji: nil
            ))
                .padding(16)
                .background(Color.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 24))
            Spacer()
        }
        .padding()
        .background(LinearGradient(colors: [.orange, .pink, .purple], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }
}

enum DebugPromptLog {
    /// `-logPendingPrompts`: prints scheduled visit prompts to the console.
    static func logIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-logPendingPrompts") else { return }
        Task {
            try? await Task.sleep(for: .seconds(3))
            for request in await UNUserNotificationCenter.current().pendingNotificationRequests() {
                let fire = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
                print("PENDING \(request.identifier) | \(request.content.title) | \(request.content.body) | fires \(fire.map { "\($0)" } ?? "?") | category \(request.content.categoryIdentifier)")
            }
        }
    }
}
#endif
