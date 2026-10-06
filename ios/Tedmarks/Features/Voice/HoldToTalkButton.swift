import SwiftUI

/// Figma 08 · Hold to talk: press and hold to record, let go to send.
struct HoldToTalkButton: View {
    let isRecording: Bool
    let isBusy: Bool
    let onPress: () -> Void
    let onRelease: () -> Void

    @State private var pressed = false

    var body: some View {
        Label(title, systemImage: isRecording ? "waveform" : "mic.fill")
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .foregroundStyle(isRecording ? Color.white : Color.accentColor)
            .background(isRecording ? Color.red : Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .scaleEffect(isRecording ? 1.03 : 1)
            .animation(.snappy, value: isRecording)
            .opacity(isBusy ? 0.5 : 1)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !pressed, !isBusy else { return }
                        pressed = true
                        onPress()
                    }
                    .onEnded { _ in
                        guard pressed else { return }
                        pressed = false
                        onRelease()
                    }
            )
            .accessibilityLabel("Hold to talk")
            .accessibilityHint("Press and hold, say what you thought, then let go.")
            .accessibilityAddTraits(.isButton)
    }

    private var title: String {
        if isBusy { return "Working on it…" }
        return isRecording ? "Listening… let go to send" : "Hold to talk"
    }
}

/// Shown over the visit while recording or while Claude reads the note.
struct VoiceStatusBanner: View {
    let transcript: String
    let isRecording: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(isRecording ? "Listening" : "Reading your note…", systemImage: isRecording ? "mic.fill" : "sparkles")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isRecording ? .red : .secondary)
            Text(transcript.isEmpty ? (isRecording ? "Say what you thought — dishes, who liked what, would you come back…" : " ") : transcript)
                .font(.body)
                .foregroundStyle(transcript.isEmpty ? .secondary : .primary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
        .shadow(radius: 8)
    }
}
