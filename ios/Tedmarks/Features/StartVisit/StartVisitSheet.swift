import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 02 · Start visit — pick the place and who's here.
struct StartVisitSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @Query(filter: #Predicate<Place> { $0.deletedAt == nil }) private var savedPlaces: [Place]
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]

    @State private var model = StartVisitModel()
    @State private var participantIds: Set<UUID> = []
    @State private var isAddingGuest = false
    @State private var newGuestName = ""
    @State private var saveError: String?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Start a visit")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
                .searchable(text: $model.searchText, isPresented: $model.isSearchPresented, prompt: "Somewhere else…")
                .onSubmit(of: .search) { Task { await model.search(savedStatus: savedStatus) } }
                .onChange(of: model.searchText) { _, text in
                    if text.isEmpty { model.clearSearch() }
                    model.searchTextChanged()
                }
                .safeAreaInset(edge: .bottom) {
                    // Hidden while picking from suggestions, so it can't start a visit at the wrong place.
                    if !isShowingSuggestions { startButton }
                }
        }
        .task {
            if participantIds.isEmpty {
                participantIds = Set(people.filter { $0.kind == .household }.map(\.id))
            }
            await model.load(savedStatus: savedStatus)
            #if DEBUG
            // Dev/testing: `simctl launch … -openStartVisit -startVisitSearch dop` pre-fills the search.
            if let text = UserDefaults.standard.string(forKey: "startVisitSearch") {
                model.isSearchPresented = true
                model.searchText = text
            }
            #endif
        }
        .alert("Add a guest", isPresented: $isAddingGuest) {
            TextField("Name", text: $newGuestName)
            Button("Add") { addGuest() }
            Button("Cancel", role: .cancel) { newGuestName = "" }
        }
        .alert("Couldn't start the visit", isPresented: .constant(saveError != nil)) {
            Button("OK") { saveError = nil }
        } message: {
            Text(saveError ?? "")
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .locating:
            ProgressView("Finding where you are…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loading:
            ProgressView("Looking for restaurants…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let failure):
            failureView(failure)
        case .loaded where isShowingSuggestions:
            suggestionList
        case .loaded:
            List {
                Section(model.isShowingSearchResults ? "Results" : "Nearby") {
                    if model.places.isEmpty {
                        Text(model.isShowingSearchResults ? "No matches." : "No restaurants found nearby. Try searching.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(model.places) { place in
                        placeRow(place)
                    }
                }
                Section("Who's here") {
                    participantChips.padding(.vertical, 4)
                }
            }
        }
    }

    private var isShowingSuggestions: Bool {
        model.phase == .loaded && !model.searchText.isEmpty && !model.isShowingSearchResults
    }

    /// Type-ahead suggestions while typing in "Somewhere else…".
    private var suggestionList: some View {
        List {
            Section {
                if model.suggestions.isEmpty {
                    HStack {
                        Text(model.isLoadingSuggestions ? "Searching…" : "No matches")
                            .foregroundStyle(.secondary)
                        if model.isLoadingSuggestions { Spacer(); ProgressView() }
                    }
                }
                ForEach(model.suggestions) { suggestion in
                    Button {
                        Task { await model.choose(suggestion) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "mappin.circle.fill")
                                .font(.title2)
                                .foregroundStyle(.red)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(suggestion.name).font(.headline).foregroundStyle(.primary)
                                if let secondary = suggestion.secondaryText {
                                    Text(secondary).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 8)
                            if let meters = suggestion.distanceMeters {
                                Text(Self.distanceText(meters)).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } footer: {
                Text("Press Search on the keyboard to see all matches.")
            }
        }
    }

    static func distanceText(_ meters: Double) -> String {
        Measurement(value: meters, unit: UnitLength.meters).formatted(.measurement(width: .abbreviated, usage: .road))
    }

    private func placeRow(_ place: NearbyPlace) -> some View {
        let isSelected = model.selectedId == place.googlePlaceId
        return Button {
            model.selectedId = place.googlePlaceId
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.name).font(.headline).foregroundStyle(.primary)
                    Text(subtitle(for: place)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                if let status = savedStatus(place) {
                    StatusBadge(status: status)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var participantChips: some View {
        FlowLayout(spacing: 8) {
            ForEach(chipPeople) { person in
                let isOn = participantIds.contains(person.id)
                Button {
                    if isOn { participantIds.remove(person.id) } else { participantIds.insert(person.id) }
                } label: {
                    Chip(title: person.displayName, systemImage: isOn ? "checkmark" : "plus", isOn: isOn)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
            Button {
                isAddingGuest = true
            } label: {
                Chip(title: "Guest", systemImage: "plus", isOn: false, outlined: true)
            }
            .buttonStyle(.plain)
        }
    }

    private var startButton: some View {
        Button {
            startVisit()
        } label: {
            Text(model.selectedPlace.map { "Start visit at \($0.name)" } ?? "Start visit")
                .font(.headline)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(model.selectedPlace == nil)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .background(.bar)
    }

    @ViewBuilder
    private func failureView(_ failure: StartVisitModel.Failure) -> some View {
        switch failure {
        case .locationDenied:
            ContentUnavailableView {
                Label("Location is off for Tedmarks", systemImage: "location.slash")
            } description: {
                Text("Tedmarks uses your location to find the restaurant you're at.")
            } actions: {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
        case .locationUnavailable:
            retryView("Couldn't find your location", systemImage: "location.slash",
                      detail: "Make sure Location Services is on, then try again.")
        case .serverUnreachable:
            retryView("Can't reach the Tedmarks server", systemImage: "wifi.exclamationmark",
                      detail: "Check your connection and try again.")
        case .server(let message):
            retryView("Couldn't load restaurants", systemImage: "exclamationmark.triangle", detail: message)
        }
    }

    private func retryView(_ title: String, systemImage: String, detail: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(detail)
        } actions: {
            Button("Try Again") { Task { await model.load(savedStatus: savedStatus) } }
        }
    }

    // MARK: - Helpers

    /// Household first (Ted, Lori), then guests seen most recently.
    private var chipPeople: [Person] {
        let household = people.filter { $0.kind == .household }
        let guests = people.filter { $0.kind == .guest }
            .sorted { ($0.lastSeenAt ?? $0.createdAt) > ($1.lastSeenAt ?? $1.createdAt) }
        return household + guests.prefix(6)
    }

    private func savedStatus(_ place: NearbyPlace) -> PlaceStatus? {
        savedPlaces.first { $0.googlePlaceId == place.googlePlaceId }?.status
    }

    private func subtitle(for place: NearbyPlace) -> String {
        let distance = Self.distanceText(place.distanceMeters)
        let street = place.address?.components(separatedBy: ",").first
        return [distance, place.primaryTypeLabel, street].compactMap { $0 }.joined(separator: " · ")
    }

    private func addGuest() {
        let name = newGuestName.trimmingCharacters(in: .whitespacesAndNewlines)
        newGuestName = ""
        guard !name.isEmpty else { return }
        if let existing = people.first(where: { $0.displayName.caseInsensitiveCompare(name) == .orderedSame }) {
            participantIds.insert(existing.id)
            return
        }
        let guest = Person(displayName: name, kind: .guest)
        context.insert(guest)
        try? context.save()
        participantIds.insert(guest.id)
    }

    private func startVisit() {
        guard let place = model.selectedPlace else { return }
        let ordered = chipPeople.map(\.id).filter { participantIds.contains($0) }
        do {
            try VisitStarter.startVisit(at: place, participantIds: ordered, in: context)
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }
}

/// A person chip in "Who's here". Built from Image + Text (not Label) so the name
/// always shows — inside a List, newer iOS versions can render a Label icon-only.
struct Chip: View {
    let title: String
    let systemImage: String
    let isOn: Bool
    var outlined = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage).font(.caption.weight(.bold))
            Text(title).lineLimit(1)
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .foregroundStyle(isOn ? Color.white : Color.primary)
        .background {
            if outlined {
                Capsule().strokeBorder(Color.secondary.opacity(0.4))
            } else {
                Capsule().fill(isOn ? Color.accentColor : Color(.secondarySystemFill))
            }
        }
        .fixedSize()
    }
}

struct StatusBadge: View {
    let status: PlaceStatus

    var body: some View {
        let (text, color): (String, Color) = switch status {
        case .wantToGo: ("Want to go", .orange)
        case .beenThere: ("Been there", .green)
        }
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}
