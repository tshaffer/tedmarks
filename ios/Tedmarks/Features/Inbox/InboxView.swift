import SwiftData
import SwiftUI
import TedmarksKit

/// Figma 10 · Inbox: voice-note drafts waiting for confirmation, and voice notes that
/// couldn't be processed yet (no connection). Later: visits suggested from photos.
struct InboxView: View {
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Draft> { $0.statusRaw == "pending" && $0.deletedAt == nil },
           sort: \Draft.createdAt, order: .reverse) private var drafts: [Draft]
    @Query(filter: #Predicate<VoiceNote> { $0.draftId == nil && $0.deletedAt == nil },
           sort: \VoiceNote.recordedAt, order: .reverse) private var unprocessed: [VoiceNote]
    @Query private var places: [Place]
    @Query private var visits: [Visit]
    @Query private var voiceNotes: [VoiceNote]

    @State private var capture = VoiceCapture()
    @State private var reviewing: Draft?

    var body: some View {
        NavigationStack {
            List {
                if !drafts.isEmpty {
                    Section("To confirm") {
                        ForEach(drafts) { draft in
                            Button { reviewing = draft } label: { draftRow(draft) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                if !unprocessed.isEmpty {
                    Section {
                        ForEach(unprocessed) { note in noteRow(note) }
                    } header: {
                        Text("Not processed yet")
                    } footer: {
                        Text("These couldn’t be read when you recorded them (no connection, or Claude was unavailable). Process sends the words — never the audio — to Claude.")
                    }
                }
            }
            .overlay {
                if drafts.isEmpty && unprocessed.isEmpty {
                    ContentUnavailableView("Nothing to review", systemImage: "tray",
                                           description: Text("Voice notes waiting for your OK show up here."))
                }
            }
            .navigationTitle("Inbox")
            .sheet(item: $reviewing) { DraftReviewSheet(draft: $0) }
            .onChange(of: capture.draftToReview) { _, draft in
                if let draft { reviewing = draft; capture.draftToReview = nil }
            }
            .alert("Voice note", isPresented: .constant(capture.message != nil)) {
                Button("OK") { capture.message = nil }
            } message: { Text(capture.message ?? "") }
        }
    }

    private func draftRow(_ draft: Draft) -> some View {
        let kept = draft.changes.count
        let transcript = voiceNotes.first { $0.id == draft.sourceId }?.transcript
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(places.first { $0.id == draft.placeId }?.name ?? "Voice note").font(.headline)
                Spacer()
                Text(draft.createdAt, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
            }
            Text("\(kept) change\(kept == 1 ? "" : "s") to confirm").font(.subheadline).foregroundStyle(.orange)
            if let transcript {
                Text("“\(transcript)”").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .contentShape(Rectangle())
    }

    private func noteRow(_ note: VoiceNote) -> some View {
        let visit = visits.first { $0.id == note.visitId }
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(visit?.place?.name ?? "Voice note").font(.headline)
                Spacer()
                Text(note.recordedAt, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
            }
            Text("“\(note.transcript)”").font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
            if let visit {
                Button {
                    Task { await capture.process(note, visit: visit, in: context) }
                } label: {
                    if capture.isProcessing { ProgressView() } else { Text("Process") }
                }
                .buttonStyle(.bordered)
                .disabled(capture.isProcessing)
            }
        }
    }
}
