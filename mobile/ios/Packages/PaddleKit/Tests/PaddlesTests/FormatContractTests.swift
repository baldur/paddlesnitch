import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// mobile/contract/format/format.json: answers produced by running the
/// website's own formatters. The app must give the same answer for every one.
@Suite struct FormatContractTests {
    struct Case: Sendable, CustomTestStringConvertible {
        let function: String
        let input: JSONValue
        let output: String
        var testDescription: String { "\(function)(\(input)) → \(output)" }
    }

    /// A case's input, kept as JSON so each function reads it its own way.
    enum JSONValue: Decodable, Sendable, CustomStringConvertible {
        case number(Double), string(String), object(Data)

        init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let number = try? container.decode(Double.self) {
                self = .number(number)
            } else if let string = try? container.decode(String.self) {
                self = .string(string)
            } else {
                // Re-encode the object so it can be decoded as a model.
                let value = try container.decode([String: AnyJSON].self)
                self = .object(try JSONEncoder().encode(value))
            }
        }

        var description: String {
            switch self {
            case .number(let n): "\(n)"
            case .string(let s): s
            case .object(let d): String(bytes: d, encoding: .utf8) ?? "?"
            }
        }
    }

    static let file = fixtures.deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "format/format.json")

    static var cases: [Case] {
        guard let data = try? Data(contentsOf: file),
            let all = try? JSONDecoder().decode([String: [Raw]].self, from: data)
        else { return [] }
        return all.sorted { $0.key < $1.key }.flatMap { function, cases in
            cases.map { Case(function: function, input: $0.in, output: $0.out) }
        }
    }

    struct Raw: Decodable {
        let `in`: JSONValue
        let out: String
    }

    @Test func theFileIsThere() {
        #expect(Self.cases.count > 40)
    }

    @Test(arguments: cases)
    func theAppSaysWhatTheWebsiteSays(_ test: Case) throws {
        #expect(try answer(test) == test.output)
    }

    func answer(_ test: Case) throws -> String {
        switch (test.function, test.input) {
        case ("fmtDur", .number(let seconds)): return Format.minutesSeconds(seconds)
        case ("fmtClock", .number(let seconds)): return Format.clock(seconds)
        case ("split500", .number(let speed)): return Format.split500(speed: speed)
        case ("compassPoint", .number(let degrees)): return Format.compass(degrees: degrees)
        // The web takes a string and gives back anything it can't parse; the
        // app only ever formats a Date, so an unparseable input stays as is.
        case ("fmtWeekday", .string(let text)): return date(text).map(Format.weekday) ?? text
        case ("fmtMonth", .string(let text)): return date(text).map(Format.month) ?? text
        case ("paddleKm", .object(let data)):
            let input = try JSONDecoder().decode(PaddleKmInput.self, from: data)
            return Format.distance(km: input.distanceKm, noGps: input.noGps == true)
        case ("noPaddleMessage", .object(let data)):
            let input = try JSONDecoder().decode(NoPaddleInput.self, from: data)
            return Format.noPaddleMessage(input.reason, hasMotion: input.hasMotion)
        default:
            Issue.record("format.json has \(test.function), which the app doesn't port yet")
            return ""
        }
    }

    struct PaddleKmInput: Decodable {
        let distanceKm: Double
        let noGps: Bool?
    }

    struct NoPaddleInput: Decodable {
        let reason: NoPaddleReason
        let hasMotion: Bool
    }

    func date(_ text: String) -> Date? {
        let withFractions = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return (try? withFractions.parse(text)) ?? (try? Date.ISO8601FormatStyle().parse(text))
    }
}

/// Any JSON value, to carry a nested object through to a model's decoder.
enum AnyJSON: Codable, Sendable {
    case number(Double), string(String), bool(Bool), object([String: AnyJSON]), array([AnyJSON]), null

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([AnyJSON].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: AnyJSON].self))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}
