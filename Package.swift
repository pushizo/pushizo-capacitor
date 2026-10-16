// swift-tools-version:5.9
import PackageDescription

// Capacitor 6/7 SPM desteği. Pushizo iOS SDK'sı `pushizo-ios` deposundan (SPM ürünü `Pushizo`) alınır.
let package = Package(
    name: "PushizoCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PushizoCapacitor", targets: ["PushizoPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "6.0.0"..<"8.0.0"),
        .package(url: "https://github.com/exec0de/pushizo-ios.git", from: "0.1.0"),
    ],
    targets: [
        .target(
            name: "PushizoPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "Pushizo", package: "pushizo-ios"),
            ],
            path: "ios/Sources/PushizoPlugin"
        ),
    ]
)
