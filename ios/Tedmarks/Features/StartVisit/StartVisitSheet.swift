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
    /// What's in view on the map (for the count of ours).
    @State private var mapBounds: MapBounds?
    /// A saved place's page, opened from the map.
    @State private var openPlace: Place?
    // What the map shows; remembered between uses.
    @AppStorage("mapShowWantToGo") private var showWantToGo = true
    @AppStorage("mapShowBeenThere") private var showBeenThere = true
    @AppStorage("mapShowGoogle") private var showGoogle = true
    /// When · Cuisine · Price · Our verdict · Tags · Google rating (MapFilters as JSON).
    @AppStorage("mapFilters") private var filtersJSON = "{}"
    /// For the filters: each of our places' verdict and cuisine, by pin id.
    @State private var ourFacts: [String: (verdict: VerdictChoice, cuisine: String?)] = [:]

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
                        prompt: usesMap ? "Search a restaurant or town" : "Somewhere else…")
            .onSubmit(of: .search) { Task { await model.search(showGoogle: showGoogle, savedStatus: savedStatus) } }
            .onChange(of: model.searchText) { _, text in
                if text.isEmpty { model.clearSearch() }
                model.searchTextChanged()
            }
            .safeAreaInset(edge: .bottom) {
                // Hidden while picking from suggestions, so it can't start a visit at the wrong place.
                if !isShowingSuggestions { bottomBar }
            }
            .navigationDestination(item: $openPlace) { PlaceDetailView(place: $0) }
        .onChange(of: model.places, initial: true) { refreshVerdicts() }
        .onChange(of: savedPlaces.count) { refreshVerdicts() }
        .onChange(of: showWantToGo) { dropHiddenChoice() }
        .onChange(of: showBeenThere) { dropHiddenChoice() }
        .onChange(of: showGoogle) { _, isOn in
            dropHiddenChoice()
            // Turned on after moving the map, or with filters the pins don't have the details for:
            // find Google's restaurants for here.
            if isOn, movedAway || googleNeedsSearching, let center = mapCenter {
                Task { await model.searchArea(center, bounds: mapBounds, savedStatus: savedStatus) }
            }
        }
        .onChange(of: filtersJSON) {
            model.filters = filters
            dropFilteredChoice()
            if showGoogle, googleNeedsSearching, let center = mapCenter ?? model.searchedCenter {
                Task { await model.searchArea(center, bounds: mapBounds, savedStatus: savedStatus) }
            }
        }
        .task {
        // Coming back to the tab keeps the list; pull down to refresh it.
        guard model.phase != .loaded else { return }
        model.filters = filters
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
                TextField("Search a restaurant or town", text: $model.searchText)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await model.search(showGoogle: showGoogle, savedStatus: savedStatus) } }
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
        VStack(alignment: .leading, spacing: 8) {
            mapFilters
            MapFilterBar(filters: filtersBinding, cuisines: cuisineChoices, tags: tagChoices, showsGoogle: showGoogle)
            ZStack(alignment: .top) {
                StartVisitMap(
                    pins: pins,
                    selectedId: model.selectedId,
                    home: model.location?.coordinate,
                    target: model.mapTarget,
                    onSelect: { model.selectedId = $0 },
                    onSelectGoogleIcon: { id in Task { await model.choose(googlePlaceId: id) } },
                    onIdle: { mapCenter = $0; mapReach = $1; mapBounds = $2 }
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))
                if model.isBusy {
                    ProgressView()
                        .padding(10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 10)
                } else if !showGoogle {
                    ourPlacesCount
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
                if !model.isBusy && filters.activeCount > 0 && !pinsInView {
                    Text("Nothing here matches your filters.")
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .padding(.top, 54)
                        .padding(.horizontal, 24)
                } else if showGoogle && model.places.isEmpty && model.morePlaces.isEmpty && !model.isBusy {
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

    /// Whether any pin shows in the map's view (pins also include our places elsewhere).
    private var pinsInView: Bool {
        guard let bounds = mapBounds else { return !pins.isEmpty }
        return pins.contains { bounds.contains(latitude: $0.place.latitude, longitude: $0.place.longitude) }
    }

    /// Which pins show; each turns on and off by itself.
    private var mapFilters: some View {
        HStack(spacing: 8) {
            MapFilterChip(title: "★ Want to go", color: .purple, isOn: $showWantToGo)
            MapFilterChip(title: "Been there", color: .green, isOn: $showBeenThere)
            MapFilterChip(title: "Google", color: .gray, isOn: $showGoogle)
        }
    }

    /// "7 want to go · 2 been there" in view, while Google's are off (its button has the spot otherwise).
    @ViewBuilder
    private var ourPlacesCount: some View {
        if showWantToGo || showBeenThere, let bounds = mapBounds {
            let inView = pins.filter { bounds.contains(latitude: $0.place.latitude, longitude: $0.place.longitude) }
            let count = { (kind: MapPin.Kind) in inView.filter { $0.kind == kind }.count }
            let parts = (showWantToGo ? ["\(count(.wantToGo)) want to go"] : []) + (showBeenThere ? ["\(count(.beenThere)) been there"] : [])
            Text(parts.joined(separator: " · "))
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.regularMaterial, in: Capsule())
                .padding(.top, 10)
        }
    }

    /// Everything that could be on the map: what Google found, and all of ours, wherever the map is.
    private var mapPlaces: [MapPlace] {
        MapPlaces.merged(
            found: model.places + model.morePlaces,
            saved: savedPlaces,
            from: model.location.map { ($0.coordinate.latitude, $0.coordinate.longitude) }
        )
    }

    private var chosen: MapPlace? {
        mapPlaces.first { $0.place.googlePlaceId == model.selectedId }
    }

    private func pin(for item: MapPlace) -> MapPin {
        switch item.saved?.status {
        case .wantToGo:
            MapPin(place: item.place, kind: .wantToGo, glyph: item.saved?.interestLevel == .curious ? "☆" : "★")
        case .beenThere:
            MapPin(place: item.place, kind: .beenThere, glyph: verdictGlyphs[item.place.googlePlaceId] ?? "?")
        case nil:
            MapPin(place: item.place, kind: .google, glyph: "🍴")
        }
    }

    private func isShown(_ kind: MapPin.Kind) -> Bool {
        switch kind {
        case .wantToGo: showWantToGo
        case .beenThere: showBeenThere
        case .google: showGoogle
        }
    }

    /// What the filters let through, ours colored as on the website. The chosen place always shows
    /// (the nearest restaurant, or one of Google's own icons tapped with Google's pins off).
    private var pins: [MapPin] {
        let f = filters
        return mapPlaces.filter { $0.place.googlePlaceId == model.selectedId || passes($0, f) }.map(pin(for:))
    }

    /// Through the toggles (Want to go, Been there, Google) and the filters.
    private func passes(_ item: MapPlace, _ f: MapFilters) -> Bool {
        guard isShown(pin(for: item).kind) else { return false }
        if let saved = item.saved {
            let facts = ourFacts[MapPlaces.pinId(for: saved)]
            return MapFiltering.matchesOurs(saved, verdict: facts?.verdict ?? .none, cuisine: facts?.cuisine, f)
        }
        return MapFiltering.matchesGoogle(item.place, f)
    }

    private func cuisine(of item: MapPlace) -> String? {
        if let saved = item.saved { return ourFacts[MapPlaces.pinId(for: saved)]?.cuisine }
        return MapFiltering.cuisine(ofGoogle: item.place)
    }

    private var inView: [MapPlace] {
        guard let bounds = mapBounds else { return mapPlaces }
        return mapPlaces.filter { bounds.contains(latitude: $0.place.latitude, longitude: $0.place.longitude) }
    }

    /// Cuisines among what the other filters leave in view (with counts), then the common ones.
    private var cuisineChoices: [MapFiltering.Choice] {
        var others = filters
        others.cuisines = []
        return MapFiltering.withCommonCuisines(MapFiltering.counts(inView.filter { passes($0, others) }.map(cuisine(of:))))
    }

    /// Our tags among what the other filters leave in view (so a second can be added: OR).
    private var tagChoices: [MapFiltering.Choice] {
        var others = filters
        others.tags = []
        let tags = inView.filter { $0.saved != nil && passes($0, others) }.flatMap { $0.saved?.tags ?? [] }
        return MapFiltering.counts(tags).filter { $0.value != MapFilters.notSet }
    }

    private var filters: MapFilters { MapFilters(json: filtersJSON) }

    private var filtersBinding: Binding<MapFilters> {
        Binding(get: { filters }, set: { filtersJSON = $0.json })
    }

    /// Google's pins lack the details the filters need, or were found for other filters.
    private var googleNeedsSearching: Bool {
        let f = filters
        return f.needsGoogleDetails ? model.detailsRequest != f.googleRequest() : model.detailsRequest != nil
    }

    /// A filter was turned off: the chosen place goes if it's one of those.
    private func dropHiddenChoice() {
        if let chosen, !isShown(pin(for: chosen).kind) { model.selectedId = nil }
    }

    /// The filters changed: the chosen place goes if they leave it out.
    private func dropFilteredChoice() {
        if let chosen, !passes(chosen, filters) { model.selectedId = nil }
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
        let subtypes = Dictionary(((try? context.fetch(FetchDescriptor<PlaceSubtype>())) ?? []).map { ($0.id, $0.name) }) { a, _ in a }
        var glyphs: [String: String] = [:]
        var facts: [String: (verdict: VerdictChoice, cuisine: String?)] = [:]
        for place in savedPlaces {
            let id = MapPlaces.pinId(for: place)
            let verdict = place.status == .beenThere ? insights.summary(for: place).verdict : .none
            if place.status == .beenThere {
                glyphs[id] = switch verdict {
                case .joint(let value): value.emoji
                case .split: "↔"
                case .none: "?"
                }
            }
            facts[id] = (VerdictChoice(verdict), MapFiltering.cuisine(of: place, subtypeName: place.subtypeId.flatMap { subtypes[$0] }))
        }
        verdictGlyphs = glyphs
        ourFacts = facts
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
                        Task { await model.choose(suggestion, showGoogle: showGoogle, savedStatus: savedStatus) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "mappin.circle.fill")
                                .font(.title2)
                                .foregroundStyle(suggestion.isArea == true ? Color.accentColor : .red)
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

    /// With the map: Start when you're near the chosen place, a card when it's far away (you're
    /// planning), or a nudge when nothing's chosen.
    @ViewBuilder
    private var bottomBar: some View {
        if usesMap, let chosen, !model.isWithinReach(chosen.place) {
            placeCard(chosen)
        } else if usesMap, chosen == nil {
            Text("Tap a pin to see the place")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(.bar)
        } else {
            startButton
        }
    }

    /// A far-away place: why it's saved, how to get there, and its page.
    private func placeCard(_ item: MapPlace) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.place.name).font(.headline).lineLimit(2)
                    Text(subtitle(for: item.place)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                if let status = item.saved?.status { StatusBadge(status: status) }
            }
            if let why = whySaved(item.saved) {
                Text(why).font(.subheadline).lineLimit(3)
            }
            HStack(spacing: 10) {
                Button {
                    openURL(GoogleMapsLink.directions(name: item.place.name, googlePlaceId: item.saved?.googlePlaceId ?? item.place.googlePlaceId))
                } label: {
                    Text("Directions").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                if let saved = item.saved {
                    Button {
                        openPlace = saved
                    } label: {
                        Text("Place page").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .controlSize(.large)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemGroupedBackground))
    }

    /// "★ Really want to go · “The chopped salad, everyone says.”"
    private func whySaved(_ place: Place?) -> String? {
        guard let place, place.status == .wantToGo else { return nil }
        let level = place.interestLevel.map { "\($0 == .curious ? "☆" : "★") \($0.label)" }
        let why = place.interestWhy.map { "“\($0)”" }
        let parts = [level, why].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Start, with the chosen place's details under its name (one control, not a card and a
    /// button), and Directions to it beside.
    private var startButton: some View {
        HStack(spacing: 10) {
            Button {
                startVisit()
            } label: {
                VStack(spacing: 2) {
                    Text(chosen.map { "Start visit at \($0.place.name)" } ?? "Start visit")
                        .font(.headline)
                        .lineLimit(1)
                    if let place = chosen?.place {
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
            .disabled(chosen == nil)

            if let place = chosen?.place {
                Button {
                    openURL(GoogleMapsLink.directions(name: place.name, googlePlaceId: chosen?.saved?.googlePlaceId ?? place.googlePlaceId))
                } label: {
                    Image(systemName: "arrow.triangle.turn.up.right.diamond.fill")
                        .font(.title2)
                        .frame(width: 30, height: 46)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityLabel("Directions to \(place.name)")
            }
        }
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
        guard let chosen else { return }
        // Ted and Lori to start; who's here can be changed on the Current visit page.
        let household = people.filter { $0.kind == .household }.map(\.id)
        do {
            if model.selectedPlace == nil, let saved = chosen.saved {
                try VisitStarter.startVisit(at: saved, participantIds: household, in: context)   // ours, not in Google's results
            } else {
                try VisitStarter.startVisit(at: chosen.place, participantIds: household, in: context)
            }
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
    }
}

/// One of the map's filters: filled in its color when on, outlined when off.
private struct MapFilterChip: View {
    let title: String
    let color: Color
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .foregroundStyle(isOn ? Color.white : Color.secondary)
                .background {
                    if isOn {
                        Capsule().fill(color)
                    } else {
                        Capsule().strokeBorder(Color.secondary.opacity(0.4))
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "On" : "Off")
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
