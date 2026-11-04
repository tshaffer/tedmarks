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
    var isSearchPresented = false
    var isShowingSearchResults = false

    /// Type-ahead suggestions for the current search text.
    var suggestions: [PlaceSuggestion] = []
    var isLoadingSuggestions = false
    private var suggestionTask: Task<Void, Never>?
    /// One token per search session (keystrokes + the final pick), for Google billing.
    private var sessionToken = UUID()

    /// "Show more": extra nearby places beyond the first 20, nearest first.
    var morePlaces: [NearbyPlace] = []
    var moreState: MoreState = .available

    enum MoreState: Equatable { case available, loading, exhausted, failed }

    /// Somewhere for the map to go (a town from the search box).
    struct MapTarget: Equatable {
        let id = UUID()
        let coordinate: CLLocationCoordinate2D
        static func == (a: MapTarget, b: MapTarget) -> Bool { a.id == b.id }
    }

    var mapTarget: MapTarget?
    /// A town gets a wider first look than the nearby radius.
    private static let townRadiusMeters = 8047

    private var morePageToken: String?
    private(set) var location: CLLocation?
    private var nearby: [NearbyPlace] = []
    /// Where the nearby list was searched from (you, or the map after "Search this area").
    private(set) var searchedCenter: CLLocationCoordinate2D?
    /// A lookup in progress while the map stays up (a tapped Google icon, "Search this area").
    var isBusy = false
    private let api = AppConfig.api

    var selectedPlace: NearbyPlace? {
        places.first { $0.googlePlaceId == selectedId } ?? morePlaces.first { $0.googlePlaceId == selectedId }
    }

    func load(savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        phase = .locating
        morePlaces = []
        morePageToken = nil
        moreState = .available
        do {
            let location = try await LocationService.currentLocation()
            self.location = location
            phase = .loading
            let found = try await api.nearbyPlaces(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                radiusMeters: NearbySearchSettings.radius()
            )
            nearby = PlaceRanking.rank(found, savedStatus: savedStatus)
            searchedCenter = location.coordinate
            show(nearby)
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    /// The map's "Search this area": restaurants around where the map is now.
    func searchArea(_ center: CLLocationCoordinate2D, radiusMeters: Int? = nil, savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        isBusy = true
        defer { isBusy = false }
        do {
            let found = try await api.nearbyPlaces(latitude: center.latitude, longitude: center.longitude, radiusMeters: radiusMeters ?? NearbySearchSettings.radius())
            nearby = PlaceRanking.rank(found, savedStatus: savedStatus)
            searchedCenter = center
            morePlaces = []
            morePageToken = nil
            moreState = .available
            isShowingSearchResults = false
            searchText = ""
            // Keep what's chosen if it's still here. Far from you nothing is chosen for you: you're planning.
            let chosen = selectedId
            show(nearby)
            if let chosen, nearby.contains(where: { $0.googlePlaceId == chosen }) {
                selectedId = chosen
            } else if let first = nearby.first, !isWithinReach(first) {
                selectedId = nil
            }
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    /// One of Google's own restaurant icons on the map was tapped: look it up and choose it.
    func choose(googlePlaceId: String) async {
        if let known = (places + morePlaces).first(where: { $0.googlePlaceId == googlePlaceId }) {
            selectedId = known.googlePlaceId
            return
        }
        guard let location else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let place = try await api.placeDetails(
                googlePlaceId: googlePlaceId,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                sessionToken: UUID()
            )
            if isShowingSearchResults { places.append(place) } else { nearby.append(place); places = nearby }
            selectedId = place.googlePlaceId
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    func search(showGoogle: Bool, savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        let text = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let location else { return }
        // The keyboard's Search on a town goes there, as tapping it would.
        if let town = suggestions.first, town.isArea == true {
            await choose(town, showGoogle: showGoogle, savedStatus: savedStatus)
            return
        }
        if phase != .loaded { phase = .loading }
        isBusy = true
        defer { isBusy = false }
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

    /// Loads the next batch of nearby restaurants (beyond the first 20).
    func loadMore() async {
        guard let location, moreState == .available else { return }
        moreState = .loading
        do {
            let shown = nearby.map(\.googlePlaceId) + morePlaces.map(\.googlePlaceId)
            let result = try await api.morePlaces(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                radiusMeters: NearbySearchSettings.radius(),
                excluding: shown,
                pageToken: morePageToken
            )
            morePlaces = (morePlaces + result.places).sorted { $0.distanceMeters < $1.distanceMeters }
            morePageToken = result.nextPageToken
            moreState = result.nextPageToken == nil ? .exhausted : .available
        } catch {
            moreState = .failed
        }
    }

    /// Called on every keystroke: waits briefly, then fetches suggestions.
    func searchTextChanged() {
        suggestionTask?.cancel()
        let text = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let location else {
            suggestions = []
            isLoadingSuggestions = false
            return
        }
        isLoadingSuggestions = true
        suggestionTask = Task { [weak self, api, sessionToken] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found = try? await api.autocomplete(
                text,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                sessionToken: sessionToken,
                includeAreas: AppConfig.googleMapsKey != nil
            )
            guard !Task.isCancelled, let self else { return }
            self.suggestions = found ?? []
            self.isLoadingSuggestions = false
        }
    }

    /// The user tapped a suggestion: look it up, put it first in the list and select it. A town
    /// moves the map there instead, with Google's restaurants if they're showing.
    func choose(_ suggestion: PlaceSuggestion, showGoogle: Bool, savedStatus: @escaping (NearbyPlace) -> PlaceStatus?) async {
        guard let location else { return }
        suggestionTask?.cancel()
        if phase != .loaded { phase = .loading }
        isBusy = true
        defer { isBusy = false }
        do {
            let place = try await api.placeDetails(
                googlePlaceId: suggestion.googlePlaceId,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                sessionToken: sessionToken
            )
            sessionToken = UUID()   // the pick ends this search session
            suggestions = []
            searchText = ""
            isSearchPresented = false
            isShowingSearchResults = false
            if suggestion.isArea == true {
                let town = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
                mapTarget = MapTarget(coordinate: town)
                selectedId = nil
                if showGoogle {
                    await searchArea(town, radiusMeters: max(NearbySearchSettings.radius(), Self.townRadiusMeters), savedStatus: savedStatus)
                }
                return
            }
            nearby = [place] + nearby.filter { $0.googlePlaceId != place.googlePlaceId }
            show(nearby)
        } catch {
            phase = .failed(Self.failure(for: error))
        }
    }

    func clearSearch() {
        guard isShowingSearchResults else { return }
        isShowingSearchResults = false
        show(nearby)
    }

    /// Close enough to start a visit; farther away, the map is for planning.
    func isWithinReach(_ place: NearbyPlace) -> Bool {
        guard let location else { return true }
        return MapPlaces.isWithinReach(place, of: (location.coordinate.latitude, location.coordinate.longitude))
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
        case TedmarksAPIError.unauthorized: .server("The server rejected this app's access key (check Config/Secrets.xcconfig).")
        case TedmarksAPIError.server(_, let message): .server(message ?? "The server returned an error.")
        default: .server("Something went wrong.")
        }
    }
}
