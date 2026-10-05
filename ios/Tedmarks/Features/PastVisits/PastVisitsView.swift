import CoreLocation
import SwiftData
import SwiftUI
import TedmarksKit

/// Past visits: every ended visit, sortable by most recent, name, or nearest.
/// Tap one to see or change its wrap-up; swipe to delete.
struct PastVisitsView: View {
    @Environment(\.modelContext) private var context
    @Query(
        filter: #Predicate<Visit> { $0.statusRaw == "ended" && $0.deletedAt == nil },
        sort: \Visit.startedAt, order: .reverse
    ) private var visits: [Visit]
    @Query private var people: [Person]
    // Re-render when verdicts or dishes change.
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var ratings: [Rating]
    @Query(filter: #Predicate<VisitItem> { $0.deletedAt == nil }) private var visitItems: [VisitItem]

    @AppStorage("pastVisits.sort") private var sort: PastVisitSort = .recent
    @State private var location: CLLocation?
    @State private var locationFailed = false
    @State private var wrapUpVisit: Visit?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if sort == .distance && location == nil {
                Section {
                    if locationFailed {
                        Label("Couldn't find your location, so these are most recent first.", systemImage: "location.slash")
                            .font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Finding where you are…").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            ForEach(sortedVisits) { visit in
                Button {
                    wrapUpVisit = visit
                } label: {
                    row(visit)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) { delete(visit) }
                }
            }
        }
        .overlay {
            if visits.isEmpty {
                ContentUnavailableView("No past visits", systemImage: "fork.knife",
                                       description: Text("Visits show up here once they're wrapped up."))
            }
        }
        .navigationTitle("Past visits")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(PastVisitSort.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
        .task(id: sort) {
            guard sort == .distance, location == nil else { return }
            locationFailed = false
            do {
                location = try await LocationService.currentLocation()
            } catch {
                locationFailed = true
            }
        }
        .sheet(item: $wrapUpVisit) { visit in
            WrapUpSheet(visit: visit)
        }
        .alert("Couldn't delete", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    // MARK: - Pieces

    private func row(_ visit: Visit) -> some View {
        let household = DishCapture.household(for: visit, people: people)
        let verdict = (try? DishCapture.verdict(for: visit, household: household, in: context)) ?? .none
        let dishCount = DishCapture.orderItems(for: visit).count
        // Nearest adds the distance, so drop the time to keep it on one line.
        var details = [visit.startedAt.formatted(date: .abbreviated, time: sort == .distance ? .omitted : .shortened),
                       "\(dishCount) dish\(dishCount == 1 ? "" : "es")"]
        if sort == .distance, let origin, let meters = PastVisits.distanceMeters(to: visit, from: origin) {
            details.insert(StartVisitSheet.distanceText(meters), at: 0)
        }
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(visit.place?.name ?? "Unknown place").font(.headline)
                Text(details.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if let text = displayText(verdict, names: personNames) {
                Text(text).font(.callout)
            }
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    // MARK: - Logic

    private var origin: (latitude: Double, longitude: Double)? {
        location.map { ($0.coordinate.latitude, $0.coordinate.longitude) }
    }

    private var sortedVisits: [Visit] {
        _ = ratings.count + visitItems.count
        return PastVisits.sorted(visits, by: sort, from: origin)
    }

    private var personNames: [String: String] {
        Dictionary(uniqueKeysWithValues: people.map { ($0.id.uuidString, $0.displayName) })
    }

    private func delete(_ visit: Visit) {
        do {
            try PastVisits.delete(visit, in: context)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
