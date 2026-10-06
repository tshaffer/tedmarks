import CoreLocation
import SwiftData
import SwiftUI
import TedmarksKit

/// Places tab: every saved restaurant — been there or want to go — searchable and sortable;
/// each opens its Place page (Figma 11).
struct PlacesView: View {
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Place> { $0.deletedAt == nil }) private var places: [Place]
    @Query private var subtypes: [PlaceSubtype]
    // Re-render when visits or ratings change (e.g. after a sync).
    @Query(filter: #Predicate<Visit> { $0.deletedAt == nil }) private var visits: [Visit]
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var ratings: [Rating]

    @AppStorage("places.filter") private var filter: PlaceFilter = .beenThere
    @AppStorage("places.sort") private var sort: PlaceSort = .nearest
    @State private var search = ""
    @State private var location: CLLocation?
    @State private var path: [UUID] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Picker("Show", selection: $filter) {
                        ForEach(PlaceFilter.allCases, id: \.self) { option in
                            Text("\(option.label) \(count(option))").tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
                ForEach(summaries) { summary in
                    NavigationLink(value: summary.place.id) { row(summary) }
                }
            }
            .listSectionSpacing(.compact)
            .overlay {
                if summaries.isEmpty {
                    if !search.isEmpty {
                        ContentUnavailableView.search(text: search)
                    } else {
                        ContentUnavailableView("No places yet", systemImage: "map",
                                               description: Text("Places you visit or save show up here."))
                    }
                }
            }
            .navigationTitle("Places")
            .searchable(text: $search, prompt: "Search by name")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Sort by", selection: $sort) {
                            ForEach(PlaceSort.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                }
            }
            .navigationDestination(for: UUID.self) { id in
                if let place = places.first(where: { $0.id == id }) { PlaceDetailView(place: place) }
            }
            .task(id: sort) {
                guard sort == .nearest, location == nil else { return }
                location = try? await LocationService.currentLocation()
            }
            #if DEBUG
            // Dev/testing: `-openPlace <name>` opens that Place page.
            .task {
                if let name = UserDefaults.standard.string(forKey: "openPlace"),
                   let place = places.first(where: { $0.name.localizedStandardContains(name) }) {
                    path = [place.id]
                }
            }
            #endif
        }
    }

    // MARK: - Rows

    private func row(_ summary: PlaceSummary) -> some View {
        let place = summary.place
        var details = [subtypeName(place), PlaceInsights.city(of: place)].compactMap { $0 }
        if let origin {
            details.append(StartVisitSheet.distanceText(PlaceInsights.distanceMeters(to: place, from: origin)))
        }
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name).font(.headline).lineLimit(1)
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                if place.status == .beenThere, summary.visitCount > 0, let last = summary.lastVisitAt {
                    Text("\(summary.visitCount) visit\(summary.visitCount == 1 ? "" : "s") · last \(last.formatted(.dateTime.month(.abbreviated).year()))")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 4)
            trailingBadge(summary)
        }
    }

    @ViewBuilder
    private func trailingBadge(_ summary: PlaceSummary) -> some View {
        if summary.place.status == .wantToGo {
            if let level = summary.place.interestLevelRaw.flatMap(InterestLevel.init) {
                Image(systemName: level == .reallyWantToGo ? "star.fill" : "star")
                    .foregroundStyle(.orange)
                    .accessibilityLabel(level.label)
            }
        } else if let text = displayText(summary.verdict, names: personNames) {
            Text(text).font(.title3)
        }
    }

    // MARK: - Data

    private var origin: (latitude: Double, longitude: Double)? {
        location.map { ($0.coordinate.latitude, $0.coordinate.longitude) }
    }

    private var summaries: [PlaceSummary] {
        _ = visits.count + ratings.count
        guard let insights = try? PlaceInsights(context: context) else { return [] }
        return insights.summaries(of: places, filter: filter, search: search, sort: sort, from: origin)
    }

    private func count(_ option: PlaceFilter) -> Int {
        switch option {
        case .beenThere: places.filter { $0.status == .beenThere }.count
        case .wantToGo: places.filter { $0.status == .wantToGo }.count
        case .all: places.count
        }
    }

    private func subtypeName(_ place: Place) -> String? {
        place.subtypeId.flatMap { id in subtypes.first { $0.id == id }?.name } ?? place.googlePrimaryTypeLabel
    }

    private var personNames: [String: String] {
        [Household.tedId.uuidString: "Ted", Household.loriId.uuidString: "Lori"]
    }
}
