import Foundation

/// Joins live speech-recognition results into one transcript. iOS sometimes treats a pause
/// as the end of a phrase: it finishes the result (or starts its partial results over) and
/// later words arrive on their own. Each finished phrase is kept, so nothing said is lost.
public struct TranscriptAssembler: Sendable {
    private var phrases: [String] = []
    private var partial = ""

    public init() {}

    /// The whole transcript so far.
    public var text: String {
        (phrases + [partial]).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// A new partial result for the current phrase.
    public mutating func update(_ newText: String) {
        if Self.looksLikeRestart(from: partial, to: newText) { commit() }
        partial = newText
    }

    /// The current phrase is final (the recognizer finished it).
    public mutating func commit() {
        let phrase = partial.trimmingCharacters(in: .whitespacesAndNewlines)
        if !phrase.isEmpty { phrases.append(phrase) }
        partial = ""
    }

    /// Partial results normally grow or revise the same words; a shorter result that begins
    /// differently means recognition started over after a pause.
    static func looksLikeRestart(from previous: String, to next: String) -> Bool {
        let firstWord = { (text: String) in text.split(separator: " ").first.map { $0.lowercased() } ?? "" }
        guard !previous.isEmpty, !next.isEmpty, next.count < previous.count else { return false }
        return firstWord(previous) != firstWord(next)
    }
}
