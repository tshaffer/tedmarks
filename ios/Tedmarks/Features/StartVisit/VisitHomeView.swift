import SwiftData
import SwiftUI
import TedmarksKit

/// Home of the Visit tab: "Start visit" when no visit is active; the current visit when one is.
struct VisitHomeView: View {
    @Binding var showStartVisit: Bool

    @Environment(\.modelContext) private var context
    @Query(
        filter: #Predicate<Visit> { $0.statusRaw == "inProgress" && $0.deletedAt == nil },
        sort: \Visit.startedAt, order: .reverse
    ) private var activeVisits: [Visit]
    @Query(
        filter: #Predicate<Visit> { $0.statusRaw == "ended" && $0.deletedAt == nil },
        sort: \Visit.startedAt, order: .reverse
    ) private var pastVisits: [Visit]
    @Query private var people: [Person]

    var body: some View {
        NavigationStack {
            List {
                if let visit = activeVisits.first {
                    Section("Now") { activeVisitCard(visit) }
                } else {
                    Section {
                        Button {
                            showStartVisit = true
                        } label: {
                            Label("Start visit", systemImage: "fork.knife.circle.fill")
                                .font(.title3.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.borderedProminent)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } footer: {
                        Text("Picks the restaurant you're at from your location.")
                    }
                }

                if !pastVisits.isEmpty {
                    Section("Recent visits") {
                        ForEach(pastVisits.prefix(10)) { visit in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(visit.place?.name ?? "Unknown place").font(.headline)
                                Text("\(visit.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(names(for: visit))")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Visit")
            .sheet(isPresented: $showStartVisit) {
                StartVisitSheet()
            }
        }
    }

    private func activeVisitCard(_ visit: Visit) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(visit.place?.name ?? "Unknown place").font(.title2.weight(.bold))
                Spacer()
                if visit.isFirstVisit {
                    Text("First visit").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.orange.opacity(0.15), in: Capsule())
                        .foregroundStyle(.orange)
                }
            }
            Text("Started \(visit.startedAt.formatted(date: .omitted, time: .shortened)) · \(names(for: visit))")
                .font(.subheadline).foregroundStyle(.secondary)
            Text("Rating dishes and wrap-up are coming next.")
                .font(.footnote).foregroundStyle(.secondary)
            Button("End visit", role: .destructive) {
                try? VisitStarter.endVisit(visit, in: context)
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 6)
    }

    private func names(for visit: Visit) -> String {
        let byId = Dictionary(uniqueKeysWithValues: people.map { ($0.id, $0.displayName) })
        let names = visit.participantIds.compactMap { byId[$0] }
        return names.isEmpty ? "No one listed" : ListFormatter.localizedString(byJoining: names)
    }
}
