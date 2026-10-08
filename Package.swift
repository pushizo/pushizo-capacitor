// swift-tools-version:5.9
import PackageDescription

// HeroSignal Capacitor eklentisi (iOS). Capacitor 6+ SPM entegrasyonu bu paketi kullanır;
// CocoaPods kullanan projeler HerosignalCapacitor.podspec ile kurar.
let package = Package(
    name: "HerosignalCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "HerosignalCapacitor", targets: ["HeroSignalCapacitorPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.0.0"),
        .package(url: "https://github.com/herosignal/herosignal-ios.git", from: "0.1.0"),
    ],
    targets: [
        .target(
            name: "HeroSignalCapacitorPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "HeroSignal", package: "herosignal-ios"),
            ],
            path: "ios/Sources/HeroSignalCapacitorPlugin"
        ),
    ]
)
