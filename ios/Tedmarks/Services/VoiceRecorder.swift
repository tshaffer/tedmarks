import AVFoundation
import Foundation
import Observation
import Speech
import TedmarksKit

/// Hold-to-talk recording: transcribes on the iPhone (Apple Speech, on-device when supported)
/// and keeps the audio in the App Group's VoiceNotes folder. Audio never leaves the phone.
@MainActor
@Observable
final class VoiceRecorder {
    enum State { case idle, recording, finishing }

    struct Recording {
        var transcript: String
        var durationSec: Double
        var audioFileName: String?
    }

    private(set) var state: State = .idle
    /// Live words while recording.
    private(set) var transcript = ""

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var fileName: String?
    private var startedAt: Date?
    private var gotFinalResult = false

    /// Asks for speech recognition and microphone access (once; iOS remembers).
    static func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    func start() throws {
        guard state == .idle else { return }
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { throw VoiceRecorderError.unavailable }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let name = "\(UUID().uuidString).m4a"
        // Audio is a nice-to-have: if the file can't be created, still transcribe.
        let file = try? AVAudioFile(
            forWriting: VoiceFiles.url(for: name),
            settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount],
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tap(request: request, file: file))
        engine.prepare()
        try engine.start()

        self.request = request
        fileName = file == nil ? nil : name
        transcript = ""
        gotFinalResult = false
        startedAt = .now
        task = recognizer.recognitionTask(with: request, resultHandler: Self.resultHandler(for: self))
        state = .recording
    }

    /// Stops and waits briefly for the final transcript.
    func stop() async -> Recording? {
        guard state == .recording else { return nil }
        state = .finishing
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)   // releases (and closes) the audio file
        request?.endAudio()
        for _ in 0..<25 where !gotFinalResult {
            try? await Task.sleep(for: .milliseconds(100))
        }
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let duration = startedAt.map { Date.now.timeIntervalSince($0) } ?? 0
        state = .idle
        return Recording(transcript: transcript.trimmingCharacters(in: .whitespacesAndNewlines),
                         durationSec: duration, audioFileName: fileName)
    }

    // Built outside the main actor: the tap and the recognizer call back on their own threads.

    private nonisolated static func tap(request: SFSpeechAudioBufferRecognitionRequest, file: AVAudioFile?) -> AVAudioNodeTapBlock {
        nonisolated(unsafe) let request = request
        let file = file
        return { buffer, _ in
            request.append(buffer)
            try? file?.write(from: buffer)
        }
    }

    private nonisolated static func resultHandler(for recorder: VoiceRecorder) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak recorder] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in
                guard let recorder else { return }
                if let text { recorder.transcript = text }
                if isFinal { recorder.gotFinalResult = true }
            }
        }
    }
}

enum VoiceRecorderError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Speech recognition isn't available right now." }
}

/// Where voice-note audio lives (App Group, so it survives with the data store).
enum VoiceFiles {
    static func url(for name: String) -> URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: TedmarksStore.appGroupId)
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = base.appending(path: "VoiceNotes", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appending(path: name)
    }
}
