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
}
#endif
