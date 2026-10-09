import CoreLocation
import Observation
import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 12 · Save a place to try: search Google (same autocomplete as Start a visit), then
/// say how much you want to go and why. Saved as "Want to go".
struct SavePlaceSheet: View {
    /// Called with the saved place (the list switches to show it).
    var onSaved: (Place) -> Void = { _ in }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var savedPlaces: [Place]

    @State private var model = SavePlaceModel()
    @State private var level: InterestLevel = .reallyWantToGo
    @State private var why = ""
    @State private var errorMessage: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                if let picked = model.picked, alreadyBeen(picked) {
                    pickedSection(picked)
                    Section {
                        Text("You've been here, so it's in Places as been there. Its verdict says whether you'd go back.")
                            .foregroundStyle(.secondary)
                    }
                } else if let picked = model.picked {
                    pickedSection(picked)
                    Section("How much do you want to go?") {
                        Picker("Interest", selection: $level) {
                            Text(InterestLevel.reallyWantToGo.label).tag(InterestLevel.reallyWantToGo)
                            Text(InterestLevel.curious.label).tag(InterestLevel.curious)
                        }
                        .pickerStyle(.segmented)
                    }
                    Section {
                        TextField("Why? (a dish, who recommended it…)", text: $why, axis: .vertical)
                            .lineLimit(2...5)
                    }
                } else {
                    searchSection
                }
            }
            .navigationTitle("Save a place to try")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(model.picked.map(alreadyBeen) ?? true)
                }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
            .task { await model.locate() }
            .onAppear { searchFocused = true }
        }
    }

    // MARK: - Sections

    private var searchSection: some View {
        Section {
            TextField("Restaurant name", text: $model.query)
                .focused($searchFocused)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onChange(of: model.query) { _, _ in model.queryChanged() }
            if model.isLoading {
                HStack { ProgressView(); Text("Searching…").foregroundStyle(.secondary) }
            }
            ForEach(model.suggestions) { suggestion in
                Button {
                    Task { await model.choose(suggestion) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(suggestion.name).foregroundStyle(.primary)
                        if let detail = suggestion.secondaryText {
                            Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            if let failure = model.failure {
                Text(failure).font(.subheadline).foregroundStyle(.orange)
            }
        } footer: {
            Text("Include the town for places farther away, e.g. “Bruno's Bend”.")
        }
    }

    private func pickedSection(_ picked: NearbyPlace) -> some View {
        Section {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(picked.name).font(.headline)
                    if let address = picked.address {
                        Text(address).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button("Change") { model.picked = nil }
                    .font(.subheadline)
            }
        }
    }

    // MARK: - Actions

    private func existing(_ picked: NearbyPlace) -> Place? {
        savedPlaces.first { $0.googlePlaceId == picked.googlePlaceId }
    }

    /// Places we've been to have a verdict instead (no "want to go back").
    private func alreadyBeen(_ picked: NearbyPlace) -> Bool {
        guard let place = existing(picked), place.deletedAt == nil, place.status == .beenThere else { return false }
        return place.visits.contains { $0.deletedAt == nil }
    }

    private func save() {
        guard let picked = model.picked else { return }
        do {
            let place = try PlaceEditing.saveToTry(picked, level: level, why: why, in: context)
            onSaved(place)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Autocomplete + details for one search session (Google bills the session as one lookup).
@MainActor
@Observable
final class SavePlaceModel {
    var query = ""
    var suggestions: [PlaceSuggestion] = []
    var picked: NearbyPlace?
    var isLoading = false
    var failure: String?

    private let api = AppConfig.api
    private var origin = SavePlaceModel.fallbackOrigin
    private var sessionToken = UUID()
    private var searchTask: Task<Void, Never>?

    /// Results are only biased toward here, so other towns still match; when location is
    /// unavailable, bias toward home (Mountain View).
    private static let fallbackOrigin = CLLocationCoordinate2D(latitude: 37.3861, longitude: -122.0839)

    func locate() async {
        if let location = try? await LocationService.currentLocation(timeout: .seconds(5)) {
            origin = location.coordinate
        }
    }

    func queryChanged() {
        searchTask?.cancel()
        failure = nil
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2 else {
            suggestions = []
            isLoading = false
            return
        }
        isLoading = true
        searchTask = Task { [weak self, api, origin, sessionToken] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found: [PlaceSuggestion]?
            do {
                found = try await api.autocomplete(text, latitude: origin.latitude, longitude: origin.longitude, sessionToken: sessionToken)
            } catch {
                found = nil
            }
            guard !Task.isCancelled, let self else { return }
            self.isLoading = false
            if let found {
                self.suggestions = found
            } else {
                self.failure = "Couldn't search right now. Check your connection."
            }
        }
    }

    func choose(_ suggestion: PlaceSuggestion) async {
        searchTask?.cancel()
        isLoading = true
        defer { isLoading = false }
        do {
            picked = try await api.placeDetails(
                googlePlaceId: suggestion.googlePlaceId,
                latitude: origin.latitude, longitude: origin.longitude, sessionToken: sessionToken
            )
            sessionToken = UUID()   // the pick ends this search session
            suggestions = []
        } catch {
            failure = "Couldn't load that place. Try again."
        }
    }
}
