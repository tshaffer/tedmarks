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
    var transcript: String { assembler.text }

    private let engine = AVAudioEngine()
    private var assembler = TranscriptAssembler()
    private var recognizer: SFSpeechRecognizer?
    /// Where the microphone tap sends audio; swapped when recognition restarts after a pause.
    private let requestBox = RequestBox()
    private var task: SFSpeechRecognitionTask?
    /// Results from an earlier recognition task (before a restart) are ignored.
    private var generation = 0
    private var fileName: String?
    private var startedAt: Date?
    private var gotFinalResult = false

    /// True once speech recognition and the microphone are both allowed.
    nonisolated static var hasPermissions: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized && AVAudioApplication.shared.recordPermission == .granted
    }

    /// Asks for speech recognition and microphone access (once; iOS remembers).
    /// Nonisolated: iOS answers on a background queue, and a main-actor callback there
    /// stops the app (Swift 6 checks isolation at run time).
    nonisolated static func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in continuation.resume(returning: status) }
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
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tap(box: requestBox, file: file))

        self.recognizer = recognizer
        assembler = TranscriptAssembler()
        fileName = file == nil ? nil : name
        gotFinalResult = false
        startRecognition()
        engine.prepare()
        try engine.start()
        startedAt = .now
        state = .recording
    }

    /// A fresh recognition request + task fed by the same microphone tap.
    private func startRecognition() {
        guard let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        requestBox.set(request)
        generation += 1
        task = recognizer.recognitionTask(with: request, resultHandler: Self.resultHandler(for: self, generation: generation))
    }

    private func handle(text: String?, isFinal: Bool, generation: Int) {
        guard generation == self.generation else { return }
        if let text { assembler.update(text) }
        guard isFinal else { return }
        assembler.commit()
        if state == .recording {
            // iOS ended the phrase at a pause; keep listening for the rest.
            startRecognition()
        } else {
            gotFinalResult = true
        }
    }

    /// Stops and waits briefly for the final transcript.
    func stop() async -> Recording? {
        guard state == .recording else { return nil }
        state = .finishing
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)   // releases (and closes) the audio file
        requestBox.endAudio()
        for _ in 0..<25 where !gotFinalResult {
            try? await Task.sleep(for: .milliseconds(100))
        }
        task?.cancel()
        task = nil
        assembler.commit()
        requestBox.set(nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let duration = startedAt.map { Date.now.timeIntervalSince($0) } ?? 0
        state = .idle
        return Recording(transcript: transcript.trimmingCharacters(in: .whitespacesAndNewlines),
                         durationSec: duration, audioFileName: fileName)
    }

    // Built outside the main actor: the tap and the recognizer call back on their own threads.

    private nonisolated static func tap(box: RequestBox, file: AVAudioFile?) -> AVAudioNodeTapBlock {
        { buffer, _ in
            box.append(buffer)
            try? file?.write(from: buffer)
        }
    }

    private nonisolated static func resultHandler(for recorder: VoiceRecorder, generation: Int) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak recorder] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in
                recorder?.handle(text: text, isFinal: isFinal, generation: generation)
            }
        }
    }
}

/// The current recognition request, shared with the audio thread.
private final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func set(_ request: SFSpeechAudioBufferRecognitionRequest?) {
        lock.withLock {
            self.request?.endAudio()
            self.request = request
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.withLock { request?.append(buffer) }
    }

    func endAudio() {
        lock.withLock { request?.endAudio() }
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
