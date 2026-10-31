// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "RedQueenIsland", platforms: [.macOS(.v14)], products: [.executable(name: "RedQueenIsland", targets: ["RedQueenIsland"])], targets: [.executableTarget(name: "RedQueenIsland")], swiftLanguageModes: [.v5])
