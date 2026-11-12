import Foundation

// Ask Tedmarks (POST /ai/ask): a question about our places, visits and menus, answered by Claude
// on the server from everything that has synced. Mirrors shared/src/api/ask.ts.

/// An earlier question and its answer, sent for follow-ups ("which of those…").
public struct AskTurn: Codable, Hashable, Sendable {
    public var question: String
    public var answer: String
    public init(question: String, answer: String) {
        self.question = question
        self.answer = answer
    }
}

/// A place an answer mentions (a server place id, which is also the local Place id).
public struct AskPlace: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var city: String?

    public var uuid: UUID? { UUID(uuidString: id) }

    public init(id: String, name: String, city: String? = nil) {
        self.id = id
        self.name = name
        self.city = city
    }
}

public struct AskResponse: Codable, Hashable, Sendable {
    /// Markdown.
    public var answer: String
    public var places: [AskPlace]
    /// Help topic slugs (the help pages are on the website).
    public var topics: [String]

    public init(answer: String, places: [AskPlace], topics: [String]) {
        self.answer = answer
        self.places = places
        self.topics = topics
    }
}

extension TedmarksAPI {
    /// Earlier turns sent with a question (the server uses the last few).
    static let askHistoryLimit = 20

    /// Asks Tedmarks. Can take a while: Claude may look up menus or hours first.
    public func ask(_ question: String, history: [AskTurn]) async throws -> AskResponse {
        struct Body: Encodable { var question: String; var history: [AskTurn]; var client = "ios" }
        let body = Body(question: question, history: Array(history.suffix(Self.askHistoryLimit)))
        let data = try await send(path: "ai/ask", method: "POST", query: [], body: try JSONEncoder().encode(body), timeout: 150)
        return try decode(AskResponse.self, from: data)
    }
}

/// The Markdown in Claude's answers, split into the blocks SwiftUI's inline Markdown can't do:
/// paragraphs, bulleted and numbered list items, and headings.
public enum AskMarkdown {
    public enum Block: Hashable, Sendable {
        case paragraph(String)
        /// `marker` is "•" or "1." etc.; `level` is 0 for top-level items.
        case listItem(marker: String, text: String, level: Int)
        case heading(String)
    }

    public static func blocks(_ markdown: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: " "))) }
            paragraph = []
        }
        for raw in markdown.components(separatedBy: .newlines) {
            let indent = raw.prefix { $0 == " " || $0 == "\t" }.count
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            let level = indent >= 2 ? 1 : 0
            if let match = line.firstMatch(of: /^[-*+]\s+(.*)$/) {
                flush()
                blocks.append(.listItem(marker: "•", text: String(match.1), level: level))
            } else if let match = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush()
                blocks.append(.listItem(marker: "\(match.1).", text: String(match.2), level: level))
            } else if let match = line.firstMatch(of: /^#{1,6}\s+(.*)$/) {
                flush()
                blocks.append(.heading(String(match.1)))
            } else if case .listItem(let marker, let text, let itemLevel)? = blocks.last, paragraph.isEmpty, indent > 0 {
                // A list item's wrapped continuation line.
                blocks[blocks.count - 1] = .listItem(marker: marker, text: "\(text) \(line)", level: itemLevel)
            } else {
                paragraph.append(line)
            }
        }
        flush()
        return blocks
    }
}
