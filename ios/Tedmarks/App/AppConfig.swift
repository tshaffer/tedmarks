import Foundation
import TedmarksKit

enum AppConfig {
    /// API base URL, from TEDMARKS_API_BASE_URL in Config/Secrets.xcconfig via Info.plist.
    static let apiBaseURL: URL = {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "TedmarksAPIBaseURL") as? String,
            !value.isEmpty, let url = URL(string: value)
        else {
            fatalError("TedmarksAPIBaseURL missing — create ios/Config/Secrets.xcconfig and rerun xcodegen")
        }
        return url
    }()

    /// Interim shared access key (until Sign in with Apple), from TEDMARKS_API_KEY.
    static let apiAccessKey: String? = {
        let value = Bundle.main.object(forInfoDictionaryKey: "TedmarksAPIKey") as? String
        return value?.isEmpty == false ? value : nil
    }()

    static let api = TedmarksAPI(baseURL: apiBaseURL, accessKey: apiAccessKey)
}
