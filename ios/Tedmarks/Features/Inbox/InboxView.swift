import SwiftUI

/// Figma 10 · Inbox: drafts to confirm, visits suggested from photos, visits without a verdict.
struct InboxView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Nothing to review", systemImage: "tray")
                .navigationTitle("Inbox")
        }
    }
}
