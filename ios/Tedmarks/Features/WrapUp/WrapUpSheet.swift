import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 05 · Wrap up: our order with ratings, the visit verdict, end the visit.
/// Also opened for past visits to review or fix ratings. "All" shows everyone's ratings at
/// once (joint unless we disagree), read-only; Us / Ted / Lori are for tapping ratings.
struct WrapUpSheet: View {
    let visit: Visit

    init(visit: Visit) {
        self.visit = visit
        // A past visit opens on everyone's ratings; one in progress on tapping them for us.
        _viewing = State(initialValue: visit.status == .inProgress ? .us : nil)
    }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]
    // Re-render when ratings change.
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var allRatings: [Rating]
    // Re-render when notes change.
    @Query(filter: #Predicate<Note> { $0.deletedAt == nil }) private var allNotes: [Note]

    /// nil = All (read-only); otherwise whose ratings taps record.
    @State private var viewing: RateFor?
    @State private var isAddingDish = false
    @State private var errorMessage: String?
    @State private var newNote = ""
    @State private var editingNote: Note?
    @State private var notesForDish: VisitItem?
    @State private var editedText = ""
    @FocusState private var isWritingNote: Bool

    var body: some View {
        NavigationStack {
            List {
                if raters.count > 1 {
                    Section {
                        Picker("Ratings", selection: $viewing) {
                            Text("All").tag(RateFor?.none)
                            Text("Us").tag(RateFor?.some(.us))
                            ForEach(raters) { person in
                                Text(person.displayName).tag(RateFor?.some(.person(person.id)))
                            }
                        }
                        .pickerStyle(.segmented)
                    } footer: {
                        Text(isShowingAll
                             ? "Everyone's ratings. Choose Us or a name to change them."
                             : "Ratings you tap now are for \(rateForLabel).")
                    }
                }

                Section {
                    if orderItems.isEmpty {
                        Text("No dishes yet.").foregroundStyle(.secondary)
                    }
                    ForEach(orderItems) { item in
                        dishRow(item)
                    }
                    .onDelete(perform: deleteItems)
                    Button {
                        isAddingDish = true
                    } label: {
                        Label("Rate another dish", systemImage: "plus")
                    }
                } header: {
                    Text(orderItems.isEmpty ? "Our order" : "Our order · \(ratedCount) of \(orderItems.count) rated")
                }

                Section {
                    RatingButtons(values: VerdictValue.buttonOrder, selected: isShowingAll ? jointValue(verdictDisplay) : recordedVerdict) { value in
                        setVerdict(value)
                    }
                    .allowsHitTesting(!isShowingAll)
                    .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                    if case .split = verdictDisplay, let text = displayText(verdictDisplay, names: names) {
                        Label(text, systemImage: "person.2").font(.subheadline).foregroundStyle(.purple)
                    }
                } header: {
                    Text("Would you come back?")
                }

                Section {
                    ForEach(visitNotes) { note in
                        Button {
                            editedText = note.text
                            editingNote = note
                        } label: {
                            Text(note.text).foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .onDelete(perform: deleteNotes)
                    HStack(alignment: .firstTextBaseline) {
                        TextField("Add a note about this visit", text: $newNote, axis: .vertical)
                            .focused($isWritingNote)
                            .lineLimit(1...6)
                        Button("Add", action: addNote)
                            .disabled(newNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } header: {
                    Text("Notes")
                } footer: {
                    Text("Anything worth remembering that isn't about one dish — the service, the room, who was there.")
                }
            }
            .navigationTitle(visit.place?.name ?? "Wrap up")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isInProgress ? "Later" : "Done") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if isInProgress {
                    Button {
                        endVisit()
                    } label: {
                        Text("End visit").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                    .background(.bar)
                }
            }
            .sheet(item: $notesForDish) { DishNotesSheet(item: $0) }
            .sheet(isPresented: $isAddingDish) {
                RateDishSheet(visit: visit)
            }
            .alert("Edit note", isPresented: .constant(editingNote != nil)) {
                TextField("Note", text: $editedText, axis: .vertical)
                Button("Save") {
                    if let note = editingNote { perform { try NoteEditing.update(note, text: editedText, in: context) } }
                    editingNote = nil
                }
                Button("Delete", role: .destructive) {
                    if let note = editingNote { perform { try NoteEditing.delete(note, in: context) } }
                    editingNote = nil
                }
                Button("Cancel", role: .cancel) { editingNote = nil }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }

    // MARK: - Rows

    private func dishRow(_ item: VisitItem) -> some View {
        let display = (try? DishCapture.display(for: item, household: householdIds, in: context)) ?? .none
        let recorded = (try? DishCapture.recordedValue(for: item.id, rateFor: rateFor, in: context)).flatMap { $0.flatMap(ItemRatingValue.init(rawValue:)) }
        let dishNotes = allNotes.filter { $0.visitItemId == item.id }.sorted { $0.createdAt < $1.createdAt }
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                // Tap the name for this dish's notes.
                Button { notesForDish = item } label: {
                    HStack(spacing: 4) {
                        Text(item.orderLabel).font(.body.weight(.medium)).foregroundStyle(.primary)
                        Image(systemName: dishNotes.isEmpty ? "square.and.pencil" : "note.text")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Notes about this dish")
                .renamesDish(item.placeItem)
                ForEach(dishNotes) { note in
                    Text(note.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                switch display {
                case .none:
                    Text("Not rated yet").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                case .split:
                    if isShowingAll {
                        Label("We disagree", systemImage: "person.2").font(.caption.weight(.semibold)).foregroundStyle(.purple)
                    } else {
                        Text("We disagree: \(displayText(display, names: names) ?? "")")
                            .font(.caption.weight(.semibold)).foregroundStyle(.purple)
                    }
                case .joint:
                    EmptyView()
                }
            }
            Spacer(minLength: 4)
            if isShowingAll {
                EveryonesRating(display: display, names: names)
            } else {
                RatingButtons(values: ItemRatingValue.buttonOrder, selected: recorded, compact: true) { value in
                    rate(item, value)
                }
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Logic

    private var isInProgress: Bool { visit.status == .inProgress }
    private var isShowingAll: Bool { viewing == nil && raters.count > 1 }
    /// Whose ratings taps record (Us when showing All, though taps are off then).
    private var rateFor: RateFor { viewing ?? .us }

    private func jointValue<V>(_ display: RatingDisplay<V>) -> V? {
        if case .joint(let value) = display { value } else { nil }
    }
    private var orderItems: [VisitItem] { _ = allRatings.count; return DishCapture.orderItems(for: visit) }
    private var householdIds: [UUID] { DishCapture.household(for: visit, people: people) }
    private var raters: [Person] { DishCapture.raters(for: visit, people: people).compactMap { id in people.first { $0.id == id } } }
    private var names: [String: String] { Dictionary(uniqueKeysWithValues: people.map { ($0.id.uuidString, $0.displayName) }) }

    private var rateForLabel: String {
        switch rateFor {
        case .us: raters.count == 2 ? "both of you" : "everyone"
        case .person(let id): people.first { $0.id == id }?.displayName ?? "one person"
        }
    }

    private var ratedCount: Int {
        orderItems.filter { ((try? DishCapture.display(for: $0, household: householdIds, in: context)) ?? .none) != .none }.count
    }

    private var verdictDisplay: RatingDisplay<VerdictValue> {
        _ = allRatings.count
        return (try? DishCapture.verdict(for: visit, household: householdIds, in: context)) ?? .none
    }

    private var recordedVerdict: VerdictValue? {
        _ = allRatings.count
        return (try? DishCapture.recordedValue(for: visit.id, rateFor: rateFor, in: context))
            .flatMap { $0.flatMap(VerdictValue.init(rawValue:)) }
    }

    private func rate(_ item: VisitItem, _ value: ItemRatingValue) {
        perform { try DishCapture.rate(item, value, for: rateFor, enteredBy: me(), in: context) }
    }

    private func setVerdict(_ value: VerdictValue) {
        perform { try DishCapture.setVerdict(visit, value, for: rateFor, enteredBy: me(), in: context) }
    }

    private func deleteItems(at offsets: IndexSet) {
        let items = orderItems
        perform { for index in offsets { try DishCapture.removeItem(items[index], in: context) } }
    }

    private var visitNotes: [Note] {
        _ = allNotes.count
        return (try? NoteEditing.visitNotes(for: visit, in: context)) ?? []
    }

    private func addNote() {
        perform { try NoteEditing.addVisitNote(newNote, to: visit, in: context) }
        if errorMessage == nil { newNote = "" }
    }

    private func deleteNotes(at offsets: IndexSet) {
        let notes = visitNotes
        perform { for index in offsets { try NoteEditing.delete(notes[index], in: context) } }
    }

    private func endVisit() {
        perform {
            visit.wrapUpCompletedAt = .now
            try VisitStarter.endVisit(visit, in: context)
        }
        if errorMessage == nil { dismiss() }
    }

    private func me() throws -> UUID? { try VisitStarter.devicePerson(in: context)?.id }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
}

/// A dish's rating for everyone, read-only: one chip when we agree, one per person when we
/// don't (outlined in purple), nothing when it isn't rated.
private struct EveryonesRating: View {
    let display: RatingDisplay<ItemRatingValue>
    let names: [String: String]

    var body: some View {
        switch display {
        case .none:
            EmptyView()
        case .joint(let value):
            chip(value.emoji, color: value.color)
                .accessibilityLabel(value.label)
        case .split(let people):
            HStack(spacing: 6) {
                ForEach(people, id: \.personId) { person in
                    chip("\(initial(person.personId)) \(person.value.emoji)", color: person.value.color, disagree: true)
                        .accessibilityLabel("\(names[person.personId] ?? "Guest"): \(person.value.label)")
                }
            }
        }
    }

    private func initial(_ personId: String) -> String {
        String((names[personId] ?? "?").prefix(1))
    }

    private func chip(_ text: String, color: Color, disagree: Bool = false) -> some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(color.opacity(0.18), in: Capsule())
            .overlay { if disagree { Capsule().strokeBorder(Color.purple, lineWidth: 1.5) } }
    }
}
