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
} catch {
    FileHandle.standardError.write(Data("contract-gen: \(error)\n".utf8))
    exit(1)
}
