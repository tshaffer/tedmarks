import Foundation
import Observation
import SwiftData
import TedmarksKit

/// Hold to talk → transcript saved as a voice note → Claude proposes changes → a draft to review.
/// If Claude can't be reached the note is kept and can be processed later from the Inbox.
@MainActor
@Observable
final class VoiceCapture {
    let recorder = VoiceRecorder()
    private(set) var isProcessing = false
    var message: String?
    /// The draft to show for confirmation.
    var draftToReview: Draft?

    func begin() async {
        guard recorder.state == .idle else { return }
        guard await VoiceRecorder.requestPermissions() else {
            message = "Tedmarks needs microphone and speech recognition access. Turn them on in Settings → Tedmarks."
            return
        }
        do {
            try recorder.start()
        } catch {
            message = error.localizedDescription
        }
    }

    func end(visit: Visit, in context: ModelContext) async {
        guard let recording = await recorder.stop() else { return }
        guard !recording.transcript.isEmpty else {
            if let name = recording.audioFileName { try? FileManager.default.removeItem(at: VoiceFiles.url(for: name)) }
            message = "Didn't catch that. Hold the button while you talk."
            return
        }
        await save(transcript: recording.transcript, durationSec: recording.durationSec,
                   audioFileName: recording.audioFileName, visit: visit, in: context)
    }

    func save(transcript: String, durationSec: Double, audioFileName: String?, visit: Visit, in context: ModelContext) async {
        do {
            let note = try VoiceDrafts.saveNote(transcript: transcript, durationSec: durationSec,
                                                audioFileName: audioFileName, visit: visit, in: context)
            await process(note, visit: visit, in: context)
        } catch {
            message = error.localizedDescription
        }
    }

    /// Sends the transcript to Claude (via the server) and opens the resulting draft.
    func process(_ note: VoiceNote, visit: Visit, in context: ModelContext) async {
        isProcessing = true
        defer { isProcessing = false }
        do {
            let request = try VoiceDrafts.request(for: note, visit: visit, in: context)
            let changes = try await AppConfig.api.structureVoice(request)
            draftToReview = try VoiceDrafts.makeDraft(from: changes, for: note, visit: visit, in: context)
        } catch TedmarksAPIError.unreachable {
            message = "Saved your note. Couldn't reach the server — it's in the Inbox to try again."
        } catch TedmarksAPIError.server(_, let detail) {
            message = "Saved your note. \(detail ?? "The server couldn't process it.") It's in the Inbox to try again."
        } catch {
            message = "Saved your note, but it couldn't be processed: \(error.localizedDescription)"
        }
    }
}
