import SwiftData
import SwiftUI
import TedmarksKit

/// Who's here, on the Current visit card: tap a chip to add or remove someone, any time during
/// the visit. A visit starts with Ted and Lori.
struct WhoIsHere: View {
    let visit: Visit

    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]

    @State private var isAddingGuest = false
    @State private var newGuestName = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WHO'S HERE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(chipPeople) { person in
                    let isOn = visit.participantIds.contains(person.id)
                    Button {
                        toggle(person, isOn: isOn)
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
        .alert("Add a guest", isPresented: $isAddingGuest) {
            TextField("Name", text: $newGuestName)
            Button("Add") { addGuest() }
            Button("Cancel", role: .cancel) { newGuestName = "" }
        }
        .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    /// Household first (Ted, Lori), then this visit's guests, then others seen most recently.
    private var chipPeople: [Person] {
        let household = people.filter { $0.kind == .household }
        let guests = people.filter { $0.kind == .guest }
        let here = guests.filter { visit.participantIds.contains($0.id) }
        let recent = guests.filter { !visit.participantIds.contains($0.id) }
            .sorted { ($0.lastSeenAt ?? $0.createdAt) > ($1.lastSeenAt ?? $1.createdAt) }
        return household + here + recent.prefix(max(0, 6 - here.count))
    }

    private func toggle(_ person: Person, isOn: Bool) {
        var ids = Set(visit.participantIds)
        if isOn { ids.remove(person.id) } else { ids.insert(person.id) }
        save(ids)
    }

    private func addGuest() {
        let name = newGuestName
        newGuestName = ""
        do {
            guard let guest = try VisitStarter.guest(named: name, in: context) else { return }
            save(Set(visit.participantIds).union([guest.id]))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Saves in chip order (household first), keeping anyone not shown as a chip.
    private func save(_ ids: Set<UUID>) {
        let shown = chipPeople.map(\.id)
        let ordered = shown.filter { ids.contains($0) } + visit.participantIds.filter { ids.contains($0) && !shown.contains($0) }
        do {
            try VisitStarter.setParticipants(ordered, for: visit, in: context)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
