import Foundation
import Recorder
import Testing

/// recorder-core's phone fixtures, replayed through this binding: every
/// `phone_*` case must write its `track.csv` and `motion.csv` byte for byte,
/// and drop what its `expect` lines say (`recorder-core/fixtures/README.md`).
struct FixtureReplayTests {
    static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // RecorderTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // PaddleKit
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // ios
        .deletingLastPathComponent()  // mobile
        .deletingLastPathComponent()  // repo
        .appending(path: "recorder-core/fixtures")

    static var cases: [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: fixtures.path)) ?? []
        return names.filter { $0.hasPrefix("phone_") }.sorted()
    }

    @Test func everyPhoneCaseIsHere() {
        // A missing folder would make the parameterised test pass with no cases.
        #expect(Self.cases.count >= 8)
        #expect(Self.cases.contains("phone_ios"))
    }

    @Test(arguments: cases)
    func writesTheSameFiles(_ name: String) throws {
        let folder = Self.fixtures.appending(path: name)
        let input = try String(contentsOf: folder.appending(path: "phone.csv"), encoding: .utf8)
        let sink = MemorySink()
        let replay = try Replay(input, sink: sink)
        for failure in replay.failures { Issue.record("\(name): \(failure)") }
        #expect(replay.expectations > 0, "\(name) checks no drop counts")
        #expect(sink.track == (try Data(contentsOf: folder.appending(path: "track.csv"))), "\(name): track.csv")
        #expect(sink.motion == (try Data(contentsOf: folder.appending(path: "motion.csv"))), "\(name): motion.csv")
    }
}

final class MemorySink: RecordingSink {
    var track = Data()
    var motion = Data()

    func write(_ line: Data, to stream: RecordingStream) {
        switch stream {
        case .track: track.append(line)
        case .motion: motion.append(line)
        }
    }
}

/// Plays a `phone.csv` into a `PhoneRecorder`, as `test/run_fixtures.c` does.
struct Replay {
    private(set) var failures: [String] = []
    private(set) var expectations = 0

    init(_ text: String, sink: RecordingSink) throws {
        var recorder: PhoneRecorder?
        for (index, raw) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("#") { continue }
            let f = line.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
            let place = "line \(index + 1)"
            if f[0] == "phone" {
                recorder = PhoneRecorder(
                    platform: f[1] == "ios" ? .iPhone : .android, motion: f[3] == "1",
                    batteryMillivolts: f[2].split(separator: " ").contains { $0 == "batt_mv" || $0 == "tracker" },
                    sink: sink)
                continue
            }
            guard let recorder else { throw ReplayError.noPhoneLine }
            try play(f, on: recorder, at: place)
        }
    }

    private mutating func play(_ f: [String], on recorder: PhoneRecorder, at place: String) throws {
        switch (f[0], f.count) {
        case ("accel", 5):
            recorder.accel(
                nanoseconds: try int(f[1]), x: try double(f[2]), y: try double(f[3]), z: try double(f[4]))
        case ("gyro", 5):
            recorder.gyro(nanoseconds: try int(f[1]), x: try double(f[2]), y: try double(f[3]), z: try double(f[4]))
        case ("location", 8):
            recorder.location(
                PhoneLocation(
                    nanoseconds: try int(f[1]), utcMilliseconds: try int(f[2]), latitude: try double(f[3]),
                    longitude: try double(f[4]), altitude: try optional(f[5]), speed: try optional(f[6]),
                    course: try optional(f[7])))
        case ("tick", 3):
            recorder.tick(nanoseconds: try int(f[1]), batteryMillivolts: UInt32(f[2]) ?? 0)
        case ("finish", 1):
            recorder.finish()
        case ("expect", 5) where f[1] == "dropped_late" && f[3] == "dropped_unpaired":
            expectations += 1
            let got = "\(recorder.droppedLate),\(recorder.droppedUnpaired)"
            if got != "\(f[2]),\(f[4])" {
                failures.append("\(place): dropped late,unpaired \(got), want \(f[2]),\(f[4])")
            }
        default:
            throw ReplayError.unreadable(place)
        }
    }
}

enum ReplayError: Error {
    case noPhoneLine
    case unreadable(String)
    case number(String)
}

private func int(_ text: String) throws -> Int64 {
    guard let value = Int64(text) else { throw ReplayError.number(text) }
    return value
}

private func double(_ text: String) throws -> Double {
    guard let value = Double(text) else { throw ReplayError.number(text) }
    return value
}

/// Empty: the platform didn't give it.
private func optional(_ text: String) throws -> Double? {
    text.isEmpty ? nil : try double(text)
}
