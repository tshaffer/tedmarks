import SwiftData
import SwiftUI
import TedmarksKit

/// Edit place: name, been there / want to go, type, tags, our review, and why we want to go.
struct EditPlaceSheet: View {
    let place: Place

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \PlaceSubtype.sortOrder) private var subtypes: [PlaceSubtype]
    @Query(filter: #Predicate<Place> { $0.deletedAt == nil }) private var allPlaces: [Place]

    @State private var changes: PlaceEditing.Changes
    @State private var errorMessage: String?
    @State private var newTag = ""

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

                tagsSection

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

    /// Tags on this place (tap ✕ to remove), a field to add one, and tags used on other places.
    private var tagsSection: some View {
        Section {
            if !changes.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(changes.tags, id: \.self) { tag in
                        Button { changes.tags.removeAll { $0 == tag } } label: {
                            HStack(spacing: 4) {
                                Text(tag)
                                Image(systemName: "xmark").font(.caption2.weight(.bold))
                            }
                            .font(.subheadline)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Color(.secondarySystemFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(tag)")
                    }
                }
                .padding(.vertical, 4)
            }
            TextField("Add a tag (patio, date night…)", text: $newTag)
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit { addTag(newTag) }
            if !suggestions.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(suggestions, id: \.self) { tag in
                        Button("+ \(tag)") { addTag(tag) }
                            .font(.subheadline)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .overlay(Capsule().strokeBorder(Color(.separator)))
                            .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Tags")
        }
    }

    /// Tags on other places that this one doesn't have (matching what's being typed), most used first.
    private var suggestions: [String] {
        var counts: [String: Int] = [:]
        for other in allPlaces { for tag in other.tags { counts[tag, default: 0] += 1 } }
        let typed = newTag.trimmingCharacters(in: .whitespaces)
        return counts
            .filter { !changes.tags.contains($0.key) && (typed.isEmpty || $0.key.localizedStandardContains(typed)) }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(12).map(\.key)
    }

    private func addTag(_ tag: String) {
        changes.tags = cleanTags(changes.tags + [tag])
        newTag = ""
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
