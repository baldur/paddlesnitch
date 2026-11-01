import Foundation
import Testing

/// Strava has gone from paddlesnitch, and the server drops its routes. The
/// contract still lists them until then, so the generated Swift has them:
/// nothing outside the generated code may name one.
@Suite struct NoStravaCallsTests {
    static let ios = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // AccountTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // PaddleKit
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // ios

    /// A Strava endpoint or procedure, or a Strava route written out.
    static let call = try? NSRegularExpression(
        pattern: #"(Endpoints|Procedures)\.\w*[Ss]trava|/strava|[Ss]trava(AppToken|Connect|Status|AutoImport|History)"#)

    static func swiftFiles(under folder: String) -> [URL] {
        let root = ios.appending(path: folder)
        let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
        return (walk?.allObjects as? [URL] ?? [])
            .filter { $0.pathExtension == "swift" && !$0.path.contains("/Generated/") }
    }

    @Test func noCodeNamesAStravaCall() throws {
        let call = try #require(Self.call)
        let files =
            Self.swiftFiles(under: "App/Sources")
            + Self.swiftFiles(under: "Packages/PaddleKit/Sources")
            .filter { !$0.path.contains("/ContractGenKit/") }
        #expect(files.count > 50, "found the sources")
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            let found = call.matches(in: text, range: NSRange(text.startIndex..., in: text))
            for match in found {
                let line =
                    text[..<(Range(match.range, in: text)?.lowerBound ?? text.startIndex)]
                    .filter { $0 == "\n" }.count + 1
                Issue.record("\(file.lastPathComponent):\(line) names a Strava call")
            }
        }
    }
}
