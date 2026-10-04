import SwiftData
import SwiftUI
import TedmarksKit

@main
struct TedmarksApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(for: Schema(tedmarksModelTypes))
            try MainActor.assumeIsolated {
                try VisitStarter.ensureHousehold(in: container.mainContext)
            }
        } catch {
            fatalError("Could not open the Tedmarks database: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
        .modelContainer(container)
    }
}
