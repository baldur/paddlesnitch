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
    static var fixtureNames: [String] {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: fixturesDirectory.path)) ?? []
        return files.filter { $0.hasSuffix(".json") }.map { String($0.dropLast(".json".count)) }.sorted()
    }

    static var procedurePaths: [String] {
        guard let data = try? Data(contentsOf: directory.appending(path: "api/procedures.json")),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [] }
        return object.keys.sorted()
    }

    /// The procedure a fixture answers: the longest procedure path that the
    /// name starts with (`paddles.get.motion-only` → `paddles.get`).
    static func procedure(forFixture name: String) -> String? {
        procedurePaths.filter { name == $0 || name.hasPrefix($0 + ".") }.max(by: { $0.count < $1.count })
    }

    static func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: fixturesDirectory.appending(path: name + ".json"))
    }

    /// A fixture wrapped as the server sends it: `{ "result": { "data": … } }`.
    static func answer(_ name: String) throws -> Data {
        Data(#"{"result":{"data":"#.utf8) + (try fixture(name)) + Data("}}".utf8)
    }
}
