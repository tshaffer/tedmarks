import Foundation

/// When the one "How was it?" prompt is sent (Figma 06/07). Stored on the phone for now.
public enum VisitPromptSettings {
    public static let delayKey = "visitPrompt.delayMinutes"
    public static let options = [60, 90, 120]
    public static let defaultDelayMinutes = 90

    /// Seconds after the visit starts. Debug builds accept `-visitPromptSeconds N` for testing.
    public static func delaySeconds(from defaults: UserDefaults = .standard) -> TimeInterval {
        #if DEBUG
        if let seconds = defaults.string(forKey: "visitPromptSeconds").flatMap(Double.init) { return seconds }
        #endif
        let minutes = defaults.object(forKey: delayKey) as? Int
        return TimeInterval((minutes.flatMap { options.contains($0) ? $0 : nil } ?? defaultDelayMinutes) * 60)
    }
}
