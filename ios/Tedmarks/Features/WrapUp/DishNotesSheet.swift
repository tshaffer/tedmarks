import SwiftData
import SwiftUI
import TedmarksKit

/// Notes about one dish on a visit ("crust was soggy", "ask for extra sauce").
struct DishNotesSheet: View {
    let item: VisitItem

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    // Re-render when notes change.
    @Query(filter: #Predicate<Note> { $0.deletedAt == nil }) private var allNotes: [Note]

    @State private var newNote = ""
    @State private var editingNote: Note?
    @State private var editedText = ""
    @State private var errorMessage: String?
    @FocusState private var isWriting: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(notes) { note in
                        Button {
                            editedText = note.text
                            editingNote = note
                        } label: {
                            Text(note.text).foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .onDelete { offsets in
                        let current = notes
                        perform { for index in offsets { try NoteEditing.delete(current[index], in: context) } }
                    }
                    HStack(alignment: .firstTextBaseline) {
                        TextField("Add a note about this dish", text: $newNote, axis: .vertical)
                            .focused($isWriting)
                            .lineLimit(1...6)
                            .submitLabel(.done)
                        Button("Add", action: add)
                            .disabled(newNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } footer: {
                    Text("Shown with this dish on the restaurant's page, to remember next time.")
                }
            }
            .navigationTitle(item.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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
            .onAppear { if notes.isEmpty { isWriting = true } }
        }
    }

    private var notes: [Note] {
        _ = allNotes.count
        return (try? NoteEditing.dishNotes(for: item, in: context)) ?? []
    }

    private func add() {
        perform { try NoteEditing.addDishNote(newNote, to: item, in: context) }
        if errorMessage == nil { newNote = "" }
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
}
