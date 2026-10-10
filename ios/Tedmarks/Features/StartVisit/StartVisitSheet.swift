import CoreLocation
import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 02 · Start visit — pick the place (who's here is on the Current visit page). The Visit tab's landing screen
/// when no visit is in progress (`embedded`, inside that tab's navigation stack), or a sheet.
/// With a Google Maps key the places are on a map (Figma 02 · map); without one, a list.
struct StartVisitSheet: View {
    var embedded = false

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @Query(filter: #Predicate<Place> { $0.deletedAt == nil }) private var savedPlaces: [Place]
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]

    @State private var model = StartVisitModel()
    @State private var saveError: String?
    @FocusState private var searchFocused: Bool
    /// Where the map has settled (for "Search this area").
    @State private var mapCenter: CLLocationCoordinate2D?
    /// How far the map shows from its center (meters).
    @State private var mapReach: Double = 500
    /// Pin glyphs for our been-there places: the verdict's emoji (or ? without one).
    @State private var verdictGlyphs: [String: String] = [:]

    private var usesMap: Bool { AppConfig.googleMapsKey != nil }

    var body: some View {
        if embedded {
            screen
        } else {
            NavigationStack {
                screen.toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
        }
    }

    private var screen: some View {
        content
            // With the map: no title and no navigation bar (our own search box), so the map gets the room.
            .navigationTitle(usesMap ? "" : "Start a visit")
            .navigationBarTitleDisplayMode(usesMap ? .inline : .automatic)
            .toolbar(embedded && usesMap ? .hidden : .automatic, for: .navigationBar)
            .searchable(if: !(embedded && usesMap), text: $model.searchText, isPresented: $model.isSearchPresented,
                        prompt: usesMap ? "Search a restaurant" : "Somewhere else…")
            .onSubmit(of: .search) { Task { await model.search(savedStatus: savedStatus) } }
            .onChange(of: model.searchText) { _, text in
                if text.isEmpty { model.clearSearch() }
                model.searchTextChanged()
            }
            .safeAreaInset(edge: .bottom) {
                // Hidden while picking from suggestions, so it can't start a visit at the wrong place.
                if !isShowingSuggestions { startButton }
            }
        .onChange(of: model.places, initial: true) { refreshVerdicts() }
        .task {
        // Coming back to the tab keeps the list; pull down to refresh it.
        guard model.phase != .loaded else { return }
        await model.load(savedStatus: savedStatus)
        #if DEBUG
        // Dev/testing: `-showMore` loads one "Show more" batch without a tap.
        if ProcessInfo.processInfo.arguments.contains("-showMore") { await model.loadMore() }
        // Dev/testing: `simctl launch … -startVisitSearch dop` pre-fills the search.
        if let text = UserDefaults.standard.string(forKey: "startVisitSearch") {
            model.isSearchPresented = true
            model.searchText = text
        }
        #endif
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
        case .loaded where usesMap:
            // Suggestions cover the map rather than replace it, so it keeps its place and zoom.
            VStack(spacing: 8) {
                if embedded { mapSearchField.padding(.horizontal).padding(.top, 8) }
                mapContent.overlay { if isShowingSuggestions { suggestionList } }
            }
            .background(Color(.systemGroupedBackground))
        case .loaded where isShowingSuggestions:
            suggestionList
        case .loaded:
            List {
                Section(model.isShowingSearchResults ? "Results" : "Nearby") {
                    if model.places.isEmpty {
                        Text(model.isShowingSearchResults
                             ? "No matches."
                             : "No restaurants within your search radius. Search by name, or change the radius in Settings.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(model.places) { place in
                        placeRow(place)
                    }
                    // Fewer than a full page (20) means Google already returned everything in range.
                    if !model.isShowingSearchResults && model.places.count >= 20 && model.morePlaces.isEmpty {
                        showMoreRow
                    }
                }
                if !model.isShowingSearchResults && !model.morePlaces.isEmpty {
                    Section("More nearby") {
                        ForEach(model.morePlaces) { place in
                            placeRow(place)
                        }
                        showMoreRow
                    }
                }
            }
            .refreshable { await model.load(savedStatus: savedStatus) }
        }
    }

    // MARK: - Map

    /// The map screen's search box (in place of the navigation bar's, which needs a bar above it).
    private var mapSearchField: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search a restaurant", text: $model.searchText)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await model.search(savedStatus: savedStatus) } }
                if !model.searchText.isEmpty {
                    Button { model.searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            if searchFocused {
                Button("Cancel") {
                    model.searchText = ""
                    searchFocused = false
                }
            }
        }
    }

    private var mapContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .top) {
                StartVisitMap(
                    pins: pins,
                    selectedId: model.selectedId,
                    home: model.location?.coordinate,
                    onSelect: { model.selectedId = $0 },
                    onSelectGoogleIcon: { id in Task { await model.choose(googlePlaceId: id) } },
                    onIdle: { mapCenter = $0; mapReach = $1 }
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))
                if model.isBusy {
                    ProgressView()
                        .padding(10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 10)
                } else if movedAway, let center = mapCenter {
                    Button {
                        Task { await model.searchArea(center, savedStatus: savedStatus) }
                    } label: {
                        Label("Search this area", systemImage: "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .padding(.top, 10)
                }
                if pins.isEmpty && !model.isBusy {
                    Text(model.isShowingSearchResults ? "No matches." : "No restaurants found here. Search by name, or move the map and Search this area.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .padding(.top, 54)
                        .padding(.horizontal, 24)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .background(Color(.systemGroupedBackground))
    }

    /// Every place found, ours colored as on the website.
    private var pins: [MapPin] {
        var seen = Set<String>()
        return (model.places + model.morePlaces).compactMap { place in
            guard seen.insert(place.googlePlaceId).inserted else { return nil }
            let saved = savedPlaces.first { $0.googlePlaceId == place.googlePlaceId }
            switch saved?.status {
            case .wantToGo:
                return MapPin(place: place, kind: .wantToGo, glyph: saved?.interestLevel == .curious ? "☆" : "★")
            case .beenThere:
                return MapPin(place: place, kind: .beenThere, glyph: verdictGlyphs[place.googlePlaceId] ?? "?")
            case nil:
                return MapPin(place: place, kind: .google, glyph: "🍴")
            }
        }
    }

    /// The map has moved well away from where the places were searched.
    /// The map has moved well away from where its pins were searched (about half of what's on
    /// screen, so a short pan zoomed in counts) — after a name search too.
    private var movedAway: Bool {
        guard let center = mapCenter, let searched = model.searchedCenter else { return false }
        let meters = CLLocation(latitude: center.latitude, longitude: center.longitude)
            .distance(from: CLLocation(latitude: searched.latitude, longitude: searched.longitude))
        return meters > max(150, mapReach * 0.5)
    }

    private func refreshVerdicts() {
        guard usesMap, let insights = try? PlaceInsights(context: context) else { return }
        var glyphs: [String: String] = [:]
        for place in savedPlaces where place.status == .beenThere {
            guard let id = place.googlePlaceId, model.places.contains(where: { $0.googlePlaceId == id }) else { continue }
            glyphs[id] = switch insights.summary(for: place).verdict {
            case .joint(let value): value.emoji
            case .split: "↔"
            case .none: "?"
            }
        }
        verdictGlyphs = glyphs
    }

    private var isShowingSuggestions: Bool {
        model.phase == .loaded && !model.searchText.isEmpty && !model.isShowingSearchResults
    }

    @ViewBuilder
    private var showMoreRow: some View {
        switch model.moreState {
        case .available, .failed:
            Button {
                Task { await model.loadMore() }
            } label: {
                Label(
                    model.moreState == .failed ? "Couldn't load more — try again" : "Show more restaurants",
                    systemImage: "chevron.down.circle"
                )
            }
        case .loading:
            HStack(spacing: 8) {
                ProgressView()
                Text("Loading more…").foregroundStyle(.secondary)
            }
        case .exhausted:
            Text("That's every restaurant Google lists within \(radiusLabel).")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var radiusLabel: String {
        let meters = NearbySearchSettings.radius()
        return NearbySearchSettings.options.first { $0.meters == meters }?.label ?? "your search radius"
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
                        searchFocused = false
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

    /// Start, with the chosen place's details under its name (one control, not a card and a button).
    private var startButton: some View {
        Button {
            startVisit()
        } label: {
            VStack(spacing: 2) {
                Text(model.selectedPlace.map { "Start visit at \($0.name)" } ?? "Start visit")
                    .font(.headline)
                    .lineLimit(1)
                if let place = model.selectedPlace {
                    Text(startDetails(place))
                        .font(.footnote)
                        .lineLimit(1)
                        .opacity(0.85)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(model.selectedPlace == nil)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .background(.bar)
    }

    /// "4 mi · Asian Restaurant · Parking lot · Been there"
    private func startDetails(_ place: NearbyPlace) -> String {
        let status: String? = switch savedStatus(place) {
        case .beenThere: "Been there"
        case .wantToGo: "Want to go"
        case nil: nil
        }
        return [subtitle(for: place), status].compactMap { $0 }.joined(separator: " · ")
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

    private func savedStatus(_ place: NearbyPlace) -> PlaceStatus? {
        savedPlaces.first { $0.googlePlaceId == place.googlePlaceId }?.status
    }

    private func subtitle(for place: NearbyPlace) -> String {
        let meters = model.location.map { CLLocation(latitude: place.latitude, longitude: place.longitude).distance(from: $0) } ?? place.distanceMeters
        let distance = Self.distanceText(meters)
        let street = place.address?.components(separatedBy: ",").first
        return [distance, place.primaryTypeLabel, street].compactMap { $0 }.joined(separator: " · ")
    }

    private func startVisit() {
        guard let place = model.selectedPlace else { return }
        // Ted and Lori to start; who's here can be changed on the Current visit page.
        let household = people.filter { $0.kind == .household }.map(\.id)
        do {
            try VisitStarter.startVisit(at: place, participantIds: household, in: context)
            // Ask once (iOS remembers): needed for the "How was it?" prompt.
            Task { await VisitPrompt.requestAuthorization() }
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
        case .wantToGo: ("Want to go", .purple)   // purple everywhere, apart from Google's orange
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

private extension View {
    /// `.searchable` in the navigation bar, or nothing (the map screen has its own search box).
    @ViewBuilder
    func searchable(if enabled: Bool, text: Binding<String>, isPresented: Binding<Bool>, prompt: String) -> some View {
        if enabled {
            searchable(text: text, isPresented: isPresented, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(prompt))
        } else {
            self
        }
    }
}
