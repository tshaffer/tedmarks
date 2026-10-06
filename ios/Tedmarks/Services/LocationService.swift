import CoreLocation

enum LocationError: Error {
    case denied
    case unavailable
}

/// One-shot "where am I?" using When-In-Use authorization (no background location — decision).
enum LocationService {
    static func currentLocation(timeout: Duration = .seconds(15)) async throws -> CLLocation {
        #if DEBUG
        // Dev/testing: `-noLocation` skips the permission prompt (it blocks scripted simulator runs).
        if ProcessInfo.processInfo.arguments.contains("-noLocation") { throw LocationError.unavailable }
        #endif
        return try await withThrowingTaskGroup(of: CLLocation.self) { group in
            group.addTask {
                let session = CLServiceSession(authorization: .whenInUse)
                defer { session.invalidate() }
                for try await update in CLLocationUpdate.liveUpdates() {
                    if update.authorizationDenied || update.authorizationDeniedGlobally || update.authorizationRestricted {
                        throw LocationError.denied
                    }
                    if let location = update.location { return location }
                }
                throw LocationError.unavailable
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw LocationError.unavailable
            }
            let location = try await group.next()!
            group.cancelAll()
            return location
        }
    }
}
