import Foundation

/// The shared contract on disk, found from this file so tests run from any
/// directory.
enum Contract {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // PaddleAPITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // PaddleKit
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // ios
        .deletingLastPathComponent()  // mobile
        .appending(path: "contract")

    static let fixturesDirectory = directory.appending(path: "fixtures/api")

    /// Fixture names without `.json`: `me.signed-in`, `paddles.get.motion-only`.
    /// `index.json` describes the others and isn't one.
    static var fixtureNames: [String] {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: fixturesDirectory.path)) ?? []
        return files.filter { $0.hasSuffix(".json") && $0 != "index.json" }.map { String($0.dropLast(".json".count)) }
            .sorted()
    }

    /// What a fixture is, from fixtures/api/index.json: the call it answers (a
    /// tRPC path or `"METHOD /path"`; nil for a refusal a group of routes
    /// shares) and the type to decode it as.
    struct Entry: Decodable {
        let call: String?
        let schema: String
    }

    /// File name without `.json` → entry.
    static var index: [String: Entry] {
        guard let data = try? Data(contentsOf: fixturesDirectory.appending(path: "index.json")),
            let entries = try? JSONDecoder().decode([String: Entry].self, from: data)
        else { return [:] }
        return Dictionary(uniqueKeysWithValues: entries.map { (String($0.key.dropLast(".json".count)), $0.value) })
    }

    static var procedurePaths: [String] {
        guard let data = try? Data(contentsOf: directory.appending(path: "api/procedures.json")),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [] }
        return object.keys.sorted()
    }

    static func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: fixturesDirectory.appending(path: name + ".json"))
    }

    /// A fixture wrapped as the server sends it: `{ "result": { "data": … } }`.
    static func answer(_ name: String) throws -> Data {
        Data(#"{"result":{"data":"#.utf8) + (try fixture(name)) + Data("}}".utf8)
    }
}
