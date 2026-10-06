import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 09 · Draft review: what Claude heard in a voice note, as changes to confirm.
/// Nothing is saved until Apply; unchecked changes are skipped. "Later" keeps it in the Inbox.
struct DraftReviewSheet: View {
    let draft: Draft

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var people: [Person]
    @Query private var voiceNotes: [VoiceNote]

    @State private var changes: [ProposedChange] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let transcript {
                    Section("You said") {
                        Text("“\(transcript)”").italic().foregroundStyle(.secondary)
                    }
                }
                if changes.isEmpty {
                    Section {
                        Text("Nothing to record from this note.").foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        ForEach($changes) { $change in
                            Button { change.keep.toggle() } label: { row(change) }
                                .buttonStyle(.plain)
                        }
                    } header: {
                        Text("Save these?")
                    } footer: {
                        Text("Tap to leave one out. Nothing is saved until you apply.")
                    }
                }
            }
            .navigationTitle(placeName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") { saveChoices(); dismiss() }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Discard", role: .destructive) { discard() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: apply) {
                    Text(applyTitle).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding()
                .background(.bar)
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
            .onAppear { changes = draft.changes }
        }
    }

    // MARK: - Rows

    private func row(_ change: ProposedChange) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: change.keep ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(change.keep ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(describe(change)).foregroundStyle(change.keep ? .primary : .secondary)
                if let evidence = change.evidence, !evidence.isEmpty {
                    Text("“\(evidence)”").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityAddTraits(change.keep ? .isSelected : [])
    }

    private func describe(_ change: ProposedChange) -> String {
        let who = change.personId.flatMap { id in people.first { $0.id == id }?.displayName }
        let dish = change.dishName ?? "a dish"
        switch change.kind {
        case "itemRating":
            let rating = change.value.flatMap(ItemRatingValue.init)
            return [rating.map { "\($0.emoji) \($0.label):" }, dish, who.map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")
        case "verdict":
            let verdict = change.value.flatMap(VerdictValue.init)
            return [verdict.map { "\($0.emoji) \($0.label)" } ?? "Verdict", who.map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")
        case "itemNote":
            return "Note on \(dish): \(change.text ?? "")"
        case "visitNote":
            return "Note: \(change.text ?? "")"
        case "visitTag":
            return "Tag: \(change.text ?? "")"
        case "addItem":
            return "Add \(dish) to our order"
        default:
            return change.text ?? change.kind
        }
    }

    // MARK: - Actions

    private var transcript: String? { voiceNotes.first { $0.id == draft.sourceId }?.transcript }

    private var placeName: String {
        let placeId = draft.placeId
        return (try? context.fetch(FetchDescriptor<Place>(predicate: #Predicate { $0.id == placeId })).first?.name) ?? "Voice note"
    }

    private var applyTitle: String {
        let count = changes.filter(\.keep).count
        if changes.isEmpty { return "Done" }
        return count == 0 ? "Save nothing" : "Apply \(count) change\(count == 1 ? "" : "s")"
    }

    private func saveChoices() {
        guard changes != draft.changes else { return }
        draft.changes = changes
        draft.modifiedAt = .now
        try? context.save()
    }

    private func apply() {
        do {
            draft.changes = changes
            if changes.contains(where: \.keep) {
                try VoiceDrafts.confirm(draft, in: context)
            } else {
                try VoiceDrafts.dismiss(draft, in: context)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func discard() {
        do {
            try VoiceDrafts.dismiss(draft, in: context)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
