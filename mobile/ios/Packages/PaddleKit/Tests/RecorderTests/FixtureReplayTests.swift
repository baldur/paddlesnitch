import Foundation
import Recorder
import Testing

/// recorder-core's phone fixtures, replayed through this binding: every
/// `phone_*` and `trace_phone_*` case must write its `track.csv`,
/// `motion.csv` and `stroke.csv` byte for byte (and `trace.csv` when it
/// calls `trace`), drop what its `expect` lines say and read the stroke rate
/// its `expect_session` lines say (`recorder-core/fixtures/README.md`).
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
        return names.filter { $0.hasPrefix("phone_") || $0.hasPrefix("trace_phone_") }.sorted()
    }

    @Test func everyPhoneCaseIsHere() {
        // A missing folder would make the parameterised test pass with no
        // cases, and a count alone would pass without the trace cases.
        #expect(Self.cases.count >= 10)
        #expect(Self.cases.contains("phone_ios"))
        #expect(Self.cases.contains("trace_phone_flat"))
        #expect(Self.cases.contains("trace_phone_paddle"))
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
        #expect(sink.stroke == (try Data(contentsOf: folder.appending(path: "stroke.csv"))), "\(name): stroke.csv")
        let traceFile = folder.appending(path: "trace.csv")
        if name.hasPrefix("trace_phone_") || FileManager.default.fileExists(atPath: traceFile.path) {
            #expect(!replay.trace.isEmpty, "\(name) calls trace")
            #expect(replay.trace == (try String(contentsOf: traceFile, encoding: .utf8)), "\(name): trace.csv")
        } else {
            #expect(replay.trace.isEmpty, "\(name) traces with no trace.csv")
        }
    }

    /// The UI tests hand the app a fixture's trace as one block of trace.csv.
    @Test func readsBackEachTraceItWrites() throws {
        for name in Self.cases where name.hasPrefix("trace_phone_") {
            let text = try String(contentsOf: Self.fixtures.appending(path: "\(name)/trace.csv"), encoding: .utf8)
            let blocks = text.components(separatedBy: "trace,").dropFirst().map { "trace," + $0 }
            #expect(!blocks.isEmpty)
            for block in blocks {
                #expect(MotionTrace(csv: block)?.csv == block, "\(name): \(block.prefix(40))")
            }
        }
        #expect(MotionTrace(csv: "trace,motion,y,2,5.00\n0,1.00\n") == nil, "fewer samples than it says")
        #expect(MotionTrace(csv: "trace,moving,y,0,5.00\n") == nil, "a status that isn't one")
    }
}

final class MemorySink: RecordingSink {
    var track = Data()
    var motion = Data()
    var stroke = Data()

    func write(_ line: Data, to stream: RecordingStream) {
        switch stream {
        case .track: track.append(line)
        case .motion: motion.append(line)
        case .stroke: stroke.append(line)
        }
    }
}

/// Plays a `phone.csv` into a `PhoneRecorder`, as `test/run_fixtures.c` does.
struct Replay {
    private(set) var failures: [String] = []
    private(set) var expectations = 0
    /// Each `trace` call, as trace.csv.
    private(set) var trace = ""
    private let sink: MemorySink

    init(_ text: String, sink: MemorySink) throws {
        self.sink = sink
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
        case ("trace", 1):
            trace += recorder.trace.csv
        case ("expect", 5) where f[1] == "dropped_late" && f[3] == "dropped_unpaired", ("expect_session", 4):
            expectations += 1
            if let failure = try expect(f, of: recorder) { failures.append("\(place): \(failure)") }
        default:
            throw ReplayError.unreadable(place)
        }
    }
}

extension Replay {
    /// An `expect` or `expect_session` line; nil if it holds.
    private func expect(_ f: [String], of recorder: PhoneRecorder) throws -> String? {
        if f[0] == "expect_session" { return session(f[1], within: try double(f[2])...(try double(f[3]))) }
        let got = "\(recorder.droppedLate),\(recorder.droppedUnpaired)"
        return got == "\(f[2]),\(f[4])" ? nil : "dropped late,unpaired \(got), want \(f[2]),\(f[4])"
    }

    /// The `session,<set>,…` line the core wrote at finish: available, and
    /// its median strokes/min in range (as `test/run_fixtures.c`). nil if so.
    private func session(_ set: String, within range: ClosedRange<Double>) -> String? {
        let lines = (String(bytes: sink.stroke, encoding: .utf8) ?? "").split(separator: "\n")
        guard let line = lines.first(where: { $0.hasPrefix("session,\(set),") }) else {
            return "no session line for \(set)"
        }
        let v = line.split(separator: ",", omittingEmptySubsequences: false)
        guard v.count >= 6, v[2] == "1", let median = Double(v[5]), range.contains(median) else {
            return "\(set) stroke rate \(line), want \(range)"
        }
        return nil
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
