import SwiftData
import SwiftUI
import TedmarksKit

extension View {
    /// Long-press → Rename dish… for a dish we named (typed, spoken, imported). A dish from the
    /// menu keeps the menu's name, so it gets nothing.
    func renamesDish(_ item: PlaceItem?) -> some View {
        modifier(RenameDishMenu(item: item))
    }

    /// The Rename dish prompt, shown while `item` is set (e.g. from a ✎ button).
    func renameDishAlert(_ item: Binding<PlaceItem?>) -> some View {
        modifier(RenameDishAlert(item: item))
    }
}

private struct RenameDishMenu: ViewModifier {
    let item: PlaceItem?
    @State private var renaming: PlaceItem?

    func body(content: Content) -> some View {
        if let item, item.canRename {
            content
                .contextMenu {
                    Button("Rename dish…", systemImage: "pencil") { renaming = item }
                }
                .renameDishAlert($renaming)
        } else {
            content
        }
    }
}

private struct RenameDishAlert: ViewModifier {
    @Binding var item: PlaceItem?

    @Environment(\.modelContext) private var context
    @State private var draft = ""
    @State private var errorMessage: String?

    func body(content: Content) -> some View {
        content
            .alert("Rename dish", isPresented: Binding(get: { item != nil }, set: { if !$0 { item = nil } })) {
                TextField("Name", text: $draft)
                    .textInputAutocapitalization(.words)
                Button("Cancel", role: .cancel) { item = nil }
                Button("Save") { save() }
            } message: {
                Text("It's renamed everywhere it was ordered.")
            }
            .onChange(of: item?.id, initial: true) { if let item { draft = item.name } }
            .alert("Couldn't rename", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
    }

    private func save() {
        guard let target = item else { return }
        item = nil
        do {
            try DishCapture.rename(target, to: draft, in: context)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
