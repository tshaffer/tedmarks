import SwiftData
import SwiftUI
import TedmarksKit

/// Edit place: name, been there / want to go, type, our review, and why we want to go.
struct EditPlaceSheet: View {
    let place: Place

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \PlaceSubtype.sortOrder) private var subtypes: [PlaceSubtype]

    @State private var changes: PlaceEditing.Changes
    @State private var errorMessage: String?

    init(place: Place) {
        self.place = place
        _changes = State(initialValue: PlaceEditing.Changes(place))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $changes.name)
                    Picker("Status", selection: $changes.status) {
                        Text("Been there").tag(PlaceStatus.beenThere)
                        Text("Want to go").tag(PlaceStatus.wantToGo)
                    }
                    Picker("Type", selection: $changes.subtypeId) {
                        Text(place.googlePrimaryTypeLabel.map { "\($0) (from Google)" } ?? "None").tag(UUID?.none)
                        ForEach(subtypes.filter { $0.deletedAt == nil }) { subtype in
                            Text(subtype.name).tag(UUID?.some(subtype.id))
                        }
                    }
                }

                Section("Our review") {
                    TextField("What we thought, what to order…", text: $changes.review, axis: .vertical)
                        .lineLimit(3...10)
                }

                Section {
                    Picker("Interest", selection: $changes.interestLevel) {
                        Text("None").tag(InterestLevel?.none)
                        Text(InterestLevel.curious.label).tag(InterestLevel?.some(.curious))
                        Text(InterestLevel.reallyWantToGo.label).tag(InterestLevel?.some(.reallyWantToGo))
                    }
                    if changes.interestLevel != nil {
                        TextField("Why?", text: $changes.interestWhy, axis: .vertical)
                            .lineLimit(2...5)
                    }
                } header: {
                    Text("Why we want to go")
                }
            }
            .navigationTitle("Edit place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func save() {
        do {
            try PlaceEditing.update(place, with: changes, in: context)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
