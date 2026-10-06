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

            infoSection
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { startVisitButton }
        .sheet(item: $wrapUpVisit) { WrapUpSheet(visit: $0) }
        .sheet(isPresented: $isEditing) { EditPlaceSheet(place: place) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button("Edit") { isEditing = true } }
        }
        #if DEBUG
        .task { if ProcessInfo.processInfo.arguments.contains("-editPlace") { isEditing = true } }
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
            .background((beenThere ? Color.green : Color.orange).opacity(0.15), in: Capsule())
            .foregroundStyle(beenThere ? .green : .orange)
    }

    private var interestSection: some View {
        Section("Why we want to go") {
            if let level = place.interestLevelRaw.flatMap(InterestLevel.init) {
                Label(level.label, systemImage: level == .reallyWantToGo ? "star.fill" : "star")
                    .foregroundStyle(.orange)
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

    private var infoSection: some View {
        Section("Info") {
            if let address = place.googleAddress {
                Button { openURL(appleMapsURL) } label: {
                    Label(address, systemImage: "mappin.and.ellipse").foregroundStyle(.primary)
                }
            }
            Menu {
                Button("Apple Maps") { openURL(appleMapsURL) }
                Button("Google Maps") { openURL(googleMapsURL) }
            } label: {
                Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond")
            }
            if let hours = place.googleWeekdayText, !hours.isEmpty {
                DisclosureGroup {
                    ForEach(hours, id: \.self) { line in
                        Text(line).font(.subheadline)
                            .fontWeight(line.hasPrefix(todayName) ? .semibold : .regular)
                    }
                } label: {
                    Label(hours.first { $0.hasPrefix(todayName) } ?? "Hours", systemImage: "clock")
                        .lineLimit(1)
                }
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

    private var appleMapsURL: URL {
        var components = URLComponents(string: "https://maps.apple.com/")!
        components.queryItems = [
            URLQueryItem(name: "q", value: place.name),
            URLQueryItem(name: "ll", value: "\(place.latitude),\(place.longitude)"),
            URLQueryItem(name: "daddr", value: "\(place.latitude),\(place.longitude)"),
        ]
        return components.url!
    }

    /// Opens the Google Maps app when installed (universal link), otherwise the website.
    private var googleMapsURL: URL {
        var components = URLComponents(string: "https://www.google.com/maps/dir/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: place.name),
        ] + (place.googlePlaceId.map { [URLQueryItem(name: "destination_place_id", value: $0)] } ?? [])
        return components.url!
    }

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
