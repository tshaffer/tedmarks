import Foundation
import Observation
import TedmarksKit

/// Where a deep link or notification wants the app to go.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()

    enum Request: Equatable {
        case startVisit
        /// Show the Visit tab (e.g. after starting a visit from a Place page).
        case currentVisit
        case rateDish(visitId: UUID, itemId: UUID?)
        case wrapUp(visitId: UUID)
    }

    var request: Request?

    /// tedmarks://start-visit · tedmarks://rate-dish?visit=…&item=… · tedmarks://wrap-up?visit=…
    func handle(_ url: URL) {
        guard url.scheme == "tedmarks" else { return }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value.flatMap(UUID.init(uuidString:)) }
        switch url.host() {
        case "start-visit": request = .startVisit
        case "rate-dish": if let visit = value("visit") { request = .rateDish(visitId: visit, itemId: value("item")) }
        case "wrap-up": if let visit = value("visit") { request = .wrapUp(visitId: visit) }
        default: break
        }
    }
}
