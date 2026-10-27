// swift-tools-version:5.9
// The recorder core as a Swift package: the iPhone app adds this folder as a
// local package and `import RecorderCore` gives it the C API directly.
import PackageDescription

let package = Package(
    name: "RecorderCore",
    products: [.library(name: "RecorderCore", targets: ["RecorderCore"])],
    targets: [
        .target(
            name: "RecorderCore",
            path: ".",
            exclude: ["test", "fixtures", "wasm", "Makefile", "CMakeLists.txt", "library.json", "CLAUDE.md", "compile_flags.txt"],
            sources: ["src"],
            publicHeadersPath: "include"
        ),
    ],
    cLanguageStandard: .c99
)
