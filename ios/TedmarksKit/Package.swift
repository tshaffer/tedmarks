// swift-tools-version: 6.0
import PackageDescription

// Shared by the Tedmarks app and its extensions (widgets, Live Activity,
// notification actions): models, rules, and App Intents.
let package = Package(
    name: "TedmarksKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "TedmarksKit", targets: ["TedmarksKit"]),
    ],
    targets: [
        .target(name: "TedmarksKit"),
        .testTarget(name: "TedmarksKitTests", dependencies: ["TedmarksKit"]),
    ]
)
