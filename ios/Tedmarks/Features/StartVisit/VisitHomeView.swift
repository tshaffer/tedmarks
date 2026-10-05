import SwiftData
import SwiftUI
import TedmarksKit

/// Home of the Visit tab: "Start visit" when no visit is active; during a visit, our order
/// with ratings plus "Rate a dish" (Figma 04) and "Wrap up" (Figma 05).
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
    // Re-render when ratings or order lines change.
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var ratings: [Rating]
    @Query(filter: #Predicate<VisitItem> { $0.deletedAt == nil }) private var visitItems: [VisitItem]

    @State private var sheet: VisitSheet?
    #if DEBUG
    @State private var debugPreviewVisit: Visit?
    #endif

    enum VisitSheet: Identifiable {
        case addToOrder(Visit)
        case rateDish(Visit, VisitItem?)
        case wrapUp(Visit)

        var id: String {
            switch self {
            case .addToOrder(let visit): "order-\(visit.id)"
            case .rateDish(let visit, let item): "rate-\(visit.id)-\(item?.id.uuidString ?? "new")"
            case .wrapUp(let visit): "wrap-\(visit.id)"
            }
        }
    }

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
                        ForEach(pastVisits.prefix(15)) { visit in
                            Button {
                                sheet = .wrapUp(visit)
                            } label: {
                                pastVisitRow(visit)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle("Visit")
            .sheet(isPresented: $showStartVisit) {
                StartVisitSheet()
            }
            #if DEBUG
            // Dev/testing: `-openWrapUp` / `-openRateDish` open the active visit's sheets without a tap.
            .task {
                let arguments = ProcessInfo.processInfo.arguments
                guard let visit = activeVisits.first else { return }
                if arguments.contains("-openWrapUp") { sheet = .wrapUp(visit) }
                if arguments.contains("-openAddToOrder") { sheet = .addToOrder(visit) }
                if arguments.contains("-previewLiveActivity") { debugPreviewVisit = visit }
                if arguments.contains("-openRateDish") {
                    sheet = .rateDish(visit, DishCapture.orderItems(for: visit).first { $0.displayName == "Funghi pizza" })
                }
            }
            #endif
            .onChange(of: AppRouter.shared.request, initial: true) { _, request in
                openRequested(request)
            }
            #if DEBUG
            .fullScreenCover(item: $debugPreviewVisit) { visit in
                DebugLiveActivityPreview(visit: visit, people: people)
            }
            #endif
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .addToOrder(let visit): AddToOrderSheet(visit: visit)
                case .rateDish(let visit, let item): RateDishSheet(visit: visit, preselected: item)
                case .wrapUp(let visit): WrapUpSheet(visit: visit)
                }
            }
        }
    }

    // MARK: - Active visit (in-app version of the Live Activity, Figma 03)

    private func activeVisitCard(_ visit: Visit) -> some View {
        let items = DishCapture.orderItems(for: visit)
        let household = DishCapture.household(for: visit, people: people)
        let rated = items.filter { emoji(for: $0, household: household) != nil }.count
        return VStack(alignment: .leading, spacing: 12) {
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

            if !items.isEmpty {
                Text("OUR ORDER · \(rated) OF \(items.count) RATED")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                FlowLayout(spacing: 6) {
                    ForEach(items) { item in
                        let badge = emoji(for: item, household: household)
                        Button {
                            sheet = .rateDish(visit, item)
                        } label: {
                            HStack(spacing: 5) {
                                Text(item.displayName).lineLimit(1)
                                if let badge {
                                    Text(badge).font(.footnote)
                                } else {
                                    Text("Rate").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                                }
                            }
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 11).padding(.vertical, 7)
                            .background {
                                if badge == nil {
                                    Capsule().strokeBorder(Color.orange, lineWidth: 1.5)
                                } else {
                                    Capsule().fill(Color(.secondarySystemFill))
                                }
                            }
                            .fixedSize()
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            HStack(spacing: 10) {
                Button {
                    sheet = .addToOrder(visit)
                } label: {
                    Label("Add dish", systemImage: "plus").frame(maxWidth: .infinity)
                }
                Button {
                    sheet = .rateDish(visit, nil)
                } label: {
                    Label("Rate dish", systemImage: "star").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Button {
                sheet = .wrapUp(visit)
            } label: {
                Text("Wrap up").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(.vertical, 6)
    }

    private func pastVisitRow(_ visit: Visit) -> some View {
        let household = DishCapture.household(for: visit, people: people)
        let verdict = (try? DishCapture.verdict(for: visit, household: household, in: context)) ?? .none
        let dishCount = DishCapture.orderItems(for: visit).count
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(visit.place?.name ?? "Unknown place").font(.headline)
                Text("\(visit.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(dishCount) dish\(dishCount == 1 ? "" : "es")")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            if let text = displayText(verdict, names: personNames) {
                Text(text).font(.callout)
            }
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    // MARK: - Helpers

    private func openRequested(_ request: AppRouter.Request?) {
        let visitId: UUID
        let itemId: UUID?
        let wrapUp: Bool
        switch request {
        case .rateDish(let v, let i): (visitId, itemId, wrapUp) = (v, i, false)
        case .wrapUp(let v): (visitId, itemId, wrapUp) = (v, nil, true)
        case .startVisit, nil: return
        }
        AppRouter.shared.request = nil
        guard let visit = (activeVisits + pastVisits).first(where: { $0.id == visitId }) else { return }
        if wrapUp {
            sheet = .wrapUp(visit)
        } else {
            sheet = .rateDish(visit, DishCapture.orderItems(for: visit).first { $0.id == itemId })
        }
    }

    private var personNames: [String: String] {
        Dictionary(uniqueKeysWithValues: people.map { ($0.id.uuidString, $0.displayName) })
    }

    private func emoji(for item: VisitItem, household: [UUID]) -> String? {
        _ = ratings.count + visitItems.count
        switch (try? DishCapture.display(for: item, household: household, in: context)) ?? .none {
        case .none: return nil
        case .joint(let value): return value.emoji
        case .split(let people): return people.map(\.value.emoji).joined(separator: "/")
        }
    }

    private func names(for visit: Visit) -> String {
        let byId = Dictionary(uniqueKeysWithValues: people.map { ($0.id, $0.displayName) })
        let names = visit.participantIds.compactMap { byId[$0] }
        return names.isEmpty ? "No one listed" : ListFormatter.localizedString(byJoining: names)
    }
}
