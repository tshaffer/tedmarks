import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 11 · Place page: what we thought (verdicts, review), what to order and skip,
/// past visits, and the practical bits (hours, directions, website).
struct PlaceDetailView: View {
    let place: Place

    @Environment(\.modelContext) private var context
    @Environment(\.openURL) private var openURL
    @Query private var subtypes: [PlaceSubtype]
    // Re-render when visits, dishes, ratings or notes change.
    @Query(filter: #Predicate<Visit> { $0.deletedAt == nil }) private var allVisits: [Visit]
    @Query(filter: #Predicate<VisitItem> { $0.deletedAt == nil }) private var allItems: [VisitItem]
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var allRatings: [Rating]
    @Query(filter: #Predicate<Note> { $0.deletedAt == nil }) private var allNotes: [Note]

    @State private var wrapUpVisit: Visit?
    @State private var errorMessage: String?
    @State private var isEditing = false
    @State private var isRefreshing = false
    @State private var showingMenu: PlaceMenu?
    @Query(filter: #Predicate<PlaceMenu> { $0.deletedAt == nil }) private var menus: [PlaceMenu]

    var body: some View {
        let _ = refreshKey
        let insights = try? PlaceInsights(context: context)
        let visits = PlaceInsights.visits(at: place)
        let dishes = insights?.dishes(at: place) ?? []

        List {
            header(insights: insights, visits: visits)

            if place.status == .wantToGo || place.interestWhy != nil {
                interestSection
            }
            if let review = place.review, !review.isEmpty {
                Section("Our review") { Text(review) }
            }
            if !placeNotes.isEmpty {
                Section("Notes") { ForEach(placeNotes) { Text($0.text) } }
            }

            dishSection("Order again", dishes.filter { $0.group == .orderAgain })
            dishSection("We disagree", dishes.filter { $0.group == .disagree })
            dishSection("Skip", dishes.filter { $0.group == .skip })
            dishSection("Not rated", dishes.filter { $0.group == .unrated })

            if !visits.isEmpty {
                Section("Visits") {
                    ForEach(visits) { visit in
                        Button { wrapUpVisit = visit } label: { visitRow(visit, insights: insights) }
                            .buttonStyle(.plain)
                    }
                }
            }

            menuSection
            hoursSection
            infoSection
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { startVisitButton }
        .sheet(item: $wrapUpVisit) { WrapUpSheet(visit: $0) }
        .sheet(isPresented: $isEditing) { EditPlaceSheet(place: place) }
        .sheet(item: $showingMenu) { MenuSheet(menu: $0, place: place) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button("Edit") { isEditing = true } }
        }
        .task { await refreshFromGoogleIfStale() }
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.arguments.contains("-editPlace") { isEditing = true }
            if ProcessInfo.processInfo.arguments.contains("-viewMenu") { showingMenu = latestReadMenu }
        }
        #endif
        .alert("Couldn't start the visit", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    // MARK: - Sections

    @ViewBuilder
    private func header(insights: PlaceInsights?, visits: [Visit]) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                // The full name (the inline title truncates long ones).
                Text(place.name).font(.title.bold())
                let details = [subtypeName, PlaceInsights.city(of: place)].compactMap { $0 }
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                }
                if !place.tags.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(place.tags, id: \.self) { tag in
                            Text(tag).font(.caption.weight(.medium))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .overlay(Capsule().strokeBorder(Color(.separator)))
                        }
                    }
                    .accessibilityLabel("Tags: \(place.tags.joined(separator: ", "))")
                }
                HStack(spacing: 8) {
                    statusChip
                    if let rating = place.googleRating {
                        Label {
                            Text("\(rating.formatted(.number.precision(.fractionLength(1))))\(place.googleRatingsCount.map { " (\($0.formatted()))" } ?? "") on Google")
                        } icon: {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                if place.status == .beenThere, let insights {
                    let verdict = insights.summary(for: place).verdict
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        if let text = displayText(verdict, names: personNames) {
                            Text(text).font(.largeTitle)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verdictLabel(verdict)).font(.headline)
                            Text(visitsLine(visits)).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let refined = place.refinedRating {
                            Text("\(refined)/10").font(.headline.monospacedDigit())
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Color(.secondarySystemFill), in: Capsule())
                                .accessibilityLabel("Rated \(refined) out of 10")
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var statusChip: some View {
        let beenThere = place.status == .beenThere
        return Text(beenThere ? "Been there" : "Want to go")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background((beenThere ? Color.green : Color.purple).opacity(0.15), in: Capsule())
            .foregroundStyle(beenThere ? .green : .purple)
    }

    private var interestSection: some View {
        Section("Why we want to go") {
            if let level = place.interestLevelRaw.flatMap(InterestLevel.init) {
                Label(level.label, systemImage: level == .reallyWantToGo ? "star.fill" : "star")
                    .foregroundStyle(.purple)
            }
            if let why = place.interestWhy, !why.isEmpty {
                Text(why)
            }
        }
    }

    @ViewBuilder
    private func dishSection(_ title: String, _ dishes: [DishSummary]) -> some View {
        if !dishes.isEmpty {
            Section(title) {
                ForEach(dishes) { dish in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(dish.item.name).font(.body.weight(.medium))
                            if dish.timesOrdered > 1 {
                                Text("×\(dish.timesOrdered)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let text = displayText(dish.latest, names: personNames) {
                                Text(text)
                            }
                        }
                        ForEach(dish.comments.prefix(2), id: \.self) { comment in
                            Text(comment).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func visitRow(_ visit: Visit, insights: PlaceInsights?) -> some View {
        let dishCount = DishCapture.orderItems(for: visit).count
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(visit.startedAt.formatted(date: .abbreviated, time: .omitted)).font(.body)
                Text(dishCount == 0 ? "No dishes recorded" : "\(dishCount) dish\(dishCount == 1 ? "" : "es")")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if visit.status == .inProgress {
                Text("Now").font(.caption.weight(.semibold)).foregroundStyle(.orange)
            } else if let insights, let text = displayText(insights.verdict(for: visit), names: personNames) {
                Text(text)
            }
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    /// View the latest menu, or snap / pick one (no visit needed).
    private var menuSection: some View {
        Section("Menu") {
            if let menu = latestReadMenu {
                Button { showingMenu = menu } label: {
                    let count = menu.extracted?.count ?? 0
                    Label("View menu · \(count) dish\(count == 1 ? "" : "es")", systemImage: "menucard")
                }
            }
            MenuPanel(place: place, visit: nil)
                .padding(.vertical, 2)
        }
    }

    private var latestReadMenu: PlaceMenu? {
        menus.filter { $0.placeId == place.id && $0.readStatus == .read }.max { $0.capturedAt < $1.capturedAt }
    }

    private var hoursSection: some View {
        Section {
            if let hours = place.googleWeekdayText, !hours.isEmpty {
                ForEach(hours, id: \.self) { line in
                    let isToday = line.hasPrefix(todayName)
                    HStack(alignment: .firstTextBaseline) {
                        Text(dayName(line)).frame(width: 100, alignment: .leading)
                        Text(dayHours(line)).foregroundStyle(isToday ? .primary : .secondary)
                        Spacer(minLength: 0)
                    }
                    .font(.subheadline)
                    .fontWeight(isToday ? .semibold : .regular)
                    .accessibilityElement(children: .combine)
                }
            } else if isRefreshing {
                HStack(spacing: 8) { ProgressView(); Text("Getting hours from Google…").foregroundStyle(.secondary) }
            } else {
                Text("No hours from Google.").foregroundStyle(.secondary)
            }
        } header: {
            Text("Hours")
        }
    }

    private var infoSection: some View {
        Section("Info") {
            if let address = place.googleAddress {
                Button { openURL(googleMapsPlaceURL) } label: {
                    Label(address, systemImage: "mappin.and.ellipse").foregroundStyle(.primary)
                }
            }
            Button { openURL(googleMapsDirectionsURL) } label: {
                Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond")
            }
            if let phone = place.googlePhone,
               let url = URL(string: "tel:" + phone.filter { $0.isNumber || $0 == "+" }) {
                Link(destination: url) { Label(phone, systemImage: "phone") }
            }
            if let website = place.googleWebsite, let url = URL(string: website) {
                Link(destination: url) {
                    Label(url.host() ?? website, systemImage: "safari")
                }
            }
        }
    }

    @ViewBuilder
    private var startVisitButton: some View {
        if !isVisitInProgressHere {
            Button(action: startVisit) {
                Label("Start a visit here", systemImage: "fork.knife")
                    .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .background(.bar)
        }
    }

    // MARK: - Helpers

    /// Any change to the queried records re-renders (and recomputes) the page.
    private var refreshKey: Int { allVisits.count + allItems.count + allRatings.count + allNotes.count }

    private var placeNotes: [Note] {
        allNotes.filter { $0.placeId == place.id && $0.visitId == nil && $0.visitItemId == nil }
    }

    private var subtypeName: String? {
        place.subtypeId.flatMap { id in subtypes.first { $0.id == id }?.name } ?? place.googlePrimaryTypeLabel
    }

    private var isVisitInProgressHere: Bool {
        PlaceInsights.visits(at: place).contains { $0.status == .inProgress }
    }

    private var personNames: [String: String] {
        [Household.tedId.uuidString: "Ted", Household.loriId.uuidString: "Lori"]
    }

    private func verdictLabel(_ verdict: RatingDisplay<VerdictValue>) -> String {
        switch verdict {
        case .none: "No verdict yet"
        case .joint(let value): value.label
        case .split: "We disagree"
        }
    }

    private func visitsLine(_ visits: [Visit]) -> String {
        guard let last = visits.first else { return "No visits recorded" }
        let count = "\(visits.count) visit\(visits.count == 1 ? "" : "s")"
        return "\(count) · last \(last.startedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private var todayName: String {
        Date.now.formatted(.dateTime.weekday(.wide))
    }

    /// "Monday" and "11:30 AM – 9:00 PM" from Google's "Monday: 11:30 AM – 9:00 PM".
    private func dayName(_ line: String) -> String {
        line.split(separator: ":", maxSplits: 1).first.map(String.init) ?? line
    }

    private func dayHours(_ line: String) -> String {
        let parts = line.split(separator: ":", maxSplits: 1)
        return parts.count == 2 ? parts[1].trimmingCharacters(in: .whitespaces) : ""
    }

    /// The place in Google Maps (opens the Google Maps app when installed — a universal link).
    private var googleMapsPlaceURL: URL {
        var components = URLComponents(string: "https://www.google.com/maps/search/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "query", value: [place.name, place.googleAddress].compactMap { $0 }.joined(separator: ", ")),
        ] + (place.googlePlaceId.map { [URLQueryItem(name: "query_place_id", value: $0)] } ?? [])
        return components.url!
    }

    /// Directions in Google Maps (the app when installed, otherwise the website).
    private var googleMapsDirectionsURL: URL {
        var components = URLComponents(string: "https://www.google.com/maps/dir/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: place.name),
        ] + (place.googlePlaceId.map { [URLQueryItem(name: "destination_place_id", value: $0)] } ?? [])
        return components.url!
    }

    /// Places saved from search have no hours; imported ones age. Ask the server to fetch the
    /// Google details (hours, website, phone, rating) when missing or over a month old, then pull.
    private func refreshFromGoogleIfStale() async {
        guard place.googlePlaceId != nil, !Self.refreshedThisSession.contains(place.id) else { return }
        let stale = place.googleFetchedAt.map { Date.now.timeIntervalSince($0) > 30 * 86_400 } ?? true
        guard place.googleWeekdayText == nil || stale else { return }
        Self.refreshedThisSession.insert(place.id)
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await AppConfig.api.refreshPlace(id: place.id)
            await SyncEngine.shared.sync()
        } catch {
            // Not on the server yet (just saved) or offline: try again next time.
            Self.refreshedThisSession.remove(place.id)
        }
    }

    private static var refreshedThisSession: Set<UUID> = []

    private func startVisit() {
        do {
            try VisitStarter.startVisit(at: place, participantIds: [Household.tedId, Household.loriId], in: context)
            Task { await VisitPrompt.requestAuthorization() }
            AppRouter.shared.request = .currentVisit
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
