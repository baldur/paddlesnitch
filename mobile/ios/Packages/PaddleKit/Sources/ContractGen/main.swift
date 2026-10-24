import ContractGenKit
import Foundation

// contract-gen <mobile/contract dir> <mobile/ios dir>
let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write(Data("usage: contract-gen <contract-dir> <ios-dir>\n".utf8))
    exit(2)
}
let contract = URL(fileURLWithPath: args[1])
let ios = URL(fileURLWithPath: args[2])

do {
    let tokens = try Data(contentsOf: contract.appending(path: "tokens/tokens.json"))
    let outputs = [
        "Packages/PaddleKit/Sources/DesignSystem/Generated/Tokens.swift": try TokensGenerator.generate(json: tokens),
        "App/Resources/Assets.xcassets/LaunchBackground.colorset/Contents.json":
            try TokensGenerator.launchBackground(json: tokens),
    ]
    for (path, text) in outputs.sorted(by: { $0.key < $1.key }) {
        try text.write(to: ios.appending(path: path), atomically: true, encoding: .utf8)
        print("wrote \(path)")
    }

    // The models directory is wholly generated: clear it so a schema removed
    // from the contract removes its Swift too.
    let api = contract.appending(path: "api")
    let modelsDir = ios.appending(path: "Packages/PaddleKit/Sources/PaddleAPI/Generated")
    var schemas: [String: Data] = [:]
    for file in try FileManager.default.contentsOfDirectory(atPath: api.path) where file.hasSuffix(".schema.json") {
        schemas[file] = try Data(contentsOf: api.appending(path: file))
    }
    let models = try ModelsGenerator.generate(
        schemas: schemas, procedures: try Data(contentsOf: api.appending(path: "procedures.json")),
        rest: try? Data(contentsOf: api.appending(path: "rest.json")))
    try? FileManager.default.removeItem(at: modelsDir)
    try FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)
    for (file, text) in models {
        try text.write(to: modelsDir.appending(path: file), atomically: true, encoding: .utf8)
    }
    print("wrote \(models.count) files to Packages/PaddleKit/Sources/PaddleAPI/Generated")
} catch {
    FileHandle.standardError.write(Data("contract-gen: \(error)\n".utf8))
    exit(1)
}
