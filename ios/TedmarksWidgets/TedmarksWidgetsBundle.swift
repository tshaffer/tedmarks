import SwiftUI
import WidgetKit

@main
struct TedmarksWidgetsBundle: WidgetBundle {
    var body: some Widget {
        StartVisitWidget()
    }
}

/// Figma 01 · Lock Screen "Start visit" widget. Placeholder: tapping opens the app.
/// Later: Control Center control and the Live Activity live in this extension too.
struct StartVisitWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StartVisit", provider: StartVisitProvider()) { _ in
            HStack(spacing: 8) {
                Image(systemName: "fork.knife.circle.fill")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 0) {
                    Text("TEDMARKS").font(.caption2).opacity(0.75)
                    Text("Start visit").font(.headline)
                }
            }
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Start visit")
        .description("One tap to start a visit.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct StartVisitEntry: TimelineEntry {
    let date: Date
}

struct StartVisitProvider: TimelineProvider {
    func placeholder(in context: Context) -> StartVisitEntry { StartVisitEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (StartVisitEntry) -> Void) {
        completion(StartVisitEntry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<StartVisitEntry>) -> Void) {
        completion(Timeline(entries: [StartVisitEntry(date: .now)], policy: .never))
    }
}
