import CoreLocation
import Foundation
import Observation
import TedmarksKit

/// State for the Start visit sheet (Figma 02).
@MainActor
@Observable
final class StartVisitModel {
    enum Phase: Equatable {
        case locating
        case loading
        case loaded
        case failed(Failure)
    }

    enum Failure: Equatable {
        case locationDenied
        case locationUnavailable
        case serverUnreachable
        case server(String)
    }

    var phase: Phase = .locating
    var places: [NearbyPlace] = []
    var selectedId: String?
    var searchText = ""
    var isShowingSearchResults = false

    private(set) var location: CLLocation?
    private var nearby: [NearbyPlace] = []
    private let api = TedmarksAPI(baseURL: AppConfig.apiBaseURL)

    var selectedPlace: NearbyPlace? { places.first { $0.googlePlaceId == selectedId } }

    func load(savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        phase = .locating
        do {
            let location = try await LocationService.currentLocation()
            self.location = location
            phase = .loading
            let defaults = UserDefaults.standard
            let range = NearbySearchSettings.range(
                startMeters: defaults.object(forKey: NearbySearchSettings.startKey) as? Int ?? NearbySearchSettings.defaultStartMeters,
                maxMeters: defaults.object(forKey: NearbySearchSettings.maxKey) as? Int ?? NearbySearchSettings.defaultMaxMeters
            )
            let found = try await api.nearbyPlaces(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                radiusMeters: range.start,
                maxRadiusMeters: range.max
            )
            nearby = PlaceRanking.rank(found, savedStatus: savedStatus)
            show(nearby)
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    func search(savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        let text = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let location else { return }
        phase = .loading
        do {
            let found = try await api.searchPlaces(
                text,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude
            )
            isShowingSearchResults = true
            show(found)
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    func clearSearch() {
        guard isShowingSearchResults else { return }
        isShowingSearchResults = false
        show(nearby)
    }

    private func show(_ list: [NearbyPlace]) {
        places = list
        selectedId = list.first?.googlePlaceId
        phase = .loaded
    }

    private static func failure(for error: Error) -> Failure {
        switch error {
        case LocationError.denied: .locationDenied
        case LocationError.unavailable: .locationUnavailable
        case TedmarksAPIError.unreachable: .serverUnreachable
        case TedmarksAPIError.server(_, let message): .server(message ?? "The server returned an error.")
        default: .server("Something went wrong.")
        }
    }
}
