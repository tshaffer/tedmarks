import SwiftUI
import TedmarksKit

/// One Ask Tedmarks conversation. Owned by the Places tab, so closing the sheet and reopening it
/// carries on (until Clear or the app quits).
@MainActor @Observable
final class AskConversation {
    struct Turn: Identifiable {
        let id = UUID()
        var question: String
        var response: AskResponse
    }

    var turns: [Turn] = []
    var pending: String?
    var errorMessage: String?
    var draft = ""

    var isEmpty: Bool { turns.isEmpty && pending == nil }

    func ask(_ raw: String) async {
        let question = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, pending == nil else { return }
        pending = question
        draft = ""
        errorMessage = nil
        defer { pending = nil }
        do {
            let history = turns.map { AskTurn(question: $0.question, answer: $0.response.answer) }
            let response = try await AppConfig.api.ask(question, history: history)
            turns.append(Turn(question: question, response: response))
        } catch {
            errorMessage = Self.message(for: error)
            draft = question
        }
    }

    func clear() {
        turns = []
        errorMessage = nil
    }

    private static func message(for error: Error) -> String {
        switch error {
        case TedmarksAPIError.unreachable: "Couldn’t reach Tedmarks. Check your connection and try again."
        case TedmarksAPIError.unauthorized: "The server rejected this app’s access key."
        case TedmarksAPIError.server(_, let message): message ?? "Couldn’t get an answer."
        default: "Couldn’t get an answer."
        }
    }
}

/// Ask Tedmarks: questions about our places, visits and menus (from everything that has synced).
struct AskSheet: View {
    @Bindable var conversation: AskConversation
    /// Opens a place the answer mentions (the sheet closes first).
    var openPlace: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isTyping: Bool

    private static let examples = [
        "Where did we have the best tacos?",
        "Which want-to-go places are open Sunday night?",
        "What did Lori order last time we had Thai?",
        "Who has a Reuben on the menu?",
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if conversation.isEmpty { examples }
                        ForEach(conversation.turns) { turn in
                            VStack(alignment: .leading, spacing: 10) {
                                QuestionBubble(text: turn.question)
                                AnswerText(markdown: turn.response.answer)
                                placeChips(turn.response.places)
                            }
                            .id(turn.id)
                        }
                        if let pending = conversation.pending {
                            VStack(alignment: .leading, spacing: 10) {
                                QuestionBubble(text: pending)
                                HStack(spacing: 8) {
                                    ProgressView()
                                    Text("Looking through Tedmarks…").foregroundStyle(.secondary)
                                }
                                .font(.subheadline)
                            }
                        }
                        if let message = conversation.errorMessage {
                            Label(message, systemImage: "exclamationmark.triangle.fill")
                                .font(.subheadline)
                                .foregroundStyle(.red)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding()
                    // Readable on iPad.
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                .onChange(of: conversation.turns.count) { withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                .onChange(of: conversation.pending) { withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
            }
            .safeAreaInset(edge: .bottom) { inputBar }
            .navigationTitle("Ask Tedmarks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !conversation.turns.isEmpty {
                        Button("Clear") { conversation.clear() }
                            .disabled(conversation.pending != nil)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    private var examples: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Ask about where we’ve been, what we ordered, our want-to-go list and menus. For example:")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ForEach(Self.examples, id: \.self) { example in
                Button { send(example) } label: {
                    Text(example)
                        .font(.subheadline)
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.45)))
                }
            }
        }
    }

    @ViewBuilder private func placeChips(_ places: [AskPlace]) -> some View {
        let openable = places.filter { $0.uuid != nil }
        if !openable.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(openable) { place in
                    Button {
                        guard let id = place.uuid else { return }
                        dismiss()
                        openPlace(id)
                    } label: {
                        Label(place.city.map { "\(place.name) · \($0)" } ?? place.name, systemImage: "mappin.circle.fill")
                            .font(.footnote.weight(.medium))
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.45)))
                    }
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(conversation.turns.isEmpty ? "Ask a question…" : "Ask a follow-up…", text: $conversation.draft, axis: .vertical)
                .lineLimit(1...4)
                .focused($isTyping)
                .submitLabel(.send)
                .onSubmit { send(conversation.draft) }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
            Button { send(conversation.draft) } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
            }
            .accessibilityLabel("Ask")
            .disabled(conversation.pending != nil || conversation.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func send(_ question: String) {
        Task { await conversation.ask(question) }
    }
}

private struct QuestionBubble: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.body.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18))
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 40)
    }
}

/// Claude's Markdown: paragraphs, lists and headings, with inline bold, italics and links.
private struct AnswerText: View {
    var markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(AskMarkdown.blocks(markdown).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    Text(inline(text))
                case .heading(let text):
                    Text(inline(text)).font(.headline)
                case .listItem(let marker, let text, let level):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(marker).foregroundStyle(.secondary)
                        Text(inline(text))
                    }
                    .padding(.leading, CGFloat(level) * 18 + 4)
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}
