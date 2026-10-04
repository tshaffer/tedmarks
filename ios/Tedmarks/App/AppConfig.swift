import Foundation

enum AppConfig {
    /// API base URL, from the TEDMARKS_API_BASE_URL build setting (ios/project.yml) via Info.plist.
    static let apiBaseURL: URL = {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "TedmarksAPIBaseURL") as? String,
            let url = URL(string: value), !value.isEmpty
        else {
            fatalError("TedmarksAPIBaseURL missing from Info.plist")
        }
        return url
    }()
}
