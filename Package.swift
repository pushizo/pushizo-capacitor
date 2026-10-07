// swift-tools-version:5.9
import PackageDescription

// Capacitor 6/7 SPM desteği. HeroSignal iOS SDK'sı `herosignal-ios` deposundan (SPM ürünü `HeroSignal`) alınır.
let package = Package(
    name: "HerosignalCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "HerosignalCapacitor", targets: ["HeroSignalPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "6.0.0"..<"8.0.0"),
        .package(url: "https://github.com/herosignal/herosignal-ios.git", from: "0.1.0"),
    ],
    targets: [
        .target(
            name: "HeroSignalPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "HeroSignal", package: "herosignal-ios"),
            ],
            path: "ios/Sources/HeroSignalPlugin"
        ),
    ]
)
