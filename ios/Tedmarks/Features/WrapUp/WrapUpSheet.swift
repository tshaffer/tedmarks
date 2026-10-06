import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 05 · Wrap up: our order with ratings, the visit verdict, end the visit.
/// Also opened for past visits to review or fix ratings.
struct WrapUpSheet: View {
    let visit: Visit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Person> { $0.deletedAt == nil }, sort: \Person.createdAt) private var people: [Person]
    // Re-render when ratings change.
    @Query(filter: #Predicate<Rating> { $0.deletedAt == nil }) private var allRatings: [Rating]
    // Re-render when notes change.
    @Query(filter: #Predicate<Note> { $0.deletedAt == nil }) private var allNotes: [Note]

    @State private var rateFor: RateFor = .us
    @State private var isAddingDish = false
    @State private var errorMessage: String?
    @State private var newNote = ""
    @State private var editingNote: Note?
    @State private var editedText = ""
    @FocusState private var isWritingNote: Bool

    var body: some View {
        NavigationStack {
            List {
                if householdPeople.count > 1 {
                    Section {
                        RateForPicker(selection: $rateFor, household: householdPeople)
                    } footer: {
                        Text("Ratings you tap now are for \(rateForLabel).")
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
                    RatingButtons(values: VerdictValue.buttonOrder, selected: recordedVerdict) { value in
                        setVerdict(value)
                    }
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
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.displayName).font(.body.weight(.medium))
                switch display {
                case .none:
                    Text("Not rated yet").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                case .split:
                    Text("We disagree: \(displayText(display, names: names) ?? "")")
                        .font(.caption.weight(.semibold)).foregroundStyle(.purple)
                case .joint:
                    EmptyView()
                }
            }
            Spacer(minLength: 4)
            RatingButtons(values: ItemRatingValue.buttonOrder, selected: recorded, compact: true) { value in
                rate(item, value)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Logic

    private var isInProgress: Bool { visit.status == .inProgress }
    private var orderItems: [VisitItem] { _ = allRatings.count; return DishCapture.orderItems(for: visit) }
    private var householdIds: [UUID] { DishCapture.household(for: visit, people: people) }
    private var householdPeople: [Person] { householdIds.compactMap { id in people.first { $0.id == id } } }
    private var names: [String: String] { Dictionary(uniqueKeysWithValues: people.map { ($0.id.uuidString, $0.displayName) }) }

    private var rateForLabel: String {
        switch rateFor {
        case .us: "both of you"
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
