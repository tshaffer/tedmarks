import SwiftData
import SwiftUI
import TedmarksKit

extension View {
    /// Long-press → Rename dish… for a dish we named (typed, spoken, imported). A dish from the
    /// menu keeps the menu's name, so it gets nothing.
    func renamesDish(_ item: PlaceItem?) -> some View {
        modifier(RenameDish(item: item))
    }
}

private struct RenameDish: ViewModifier {
    let item: PlaceItem?

    @Environment(\.modelContext) private var context
    @State private var isRenaming = false
    @State private var draft = ""
    @State private var errorMessage: String?

    func body(content: Content) -> some View {
        if let item, item.canRename {
            content
                .contextMenu {
                    Button("Rename dish…", systemImage: "pencil") {
                        draft = item.name
                        isRenaming = true
                    }
                }
                .alert("Rename dish", isPresented: $isRenaming) {
                    TextField("Name", text: $draft)
                        .textInputAutocapitalization(.words)
                    Button("Cancel", role: .cancel) {}
                    Button("Save") { save(item) }
                } message: {
                    Text("It's renamed everywhere it was ordered.")
                }
                .alert("Couldn't rename", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                    Button("OK") { errorMessage = nil }
                } message: {
                    Text(errorMessage ?? "")
                }
        } else {
            content
        }
    }

    private func save(_ item: PlaceItem) {
        do {
            try DishCapture.rename(item, to: draft, in: context)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
