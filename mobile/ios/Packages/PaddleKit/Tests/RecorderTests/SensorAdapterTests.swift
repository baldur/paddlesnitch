import CoreLocation
import Foundation
import Recorder
import Testing

/// The iPhone's side of the sensor convention, on synthetic Core Motion
/// events: the app passes Core Motion's values untouched, and the layer writes
/// them in the tracker's convention (the axis pointing up reads +1 g; deg/s).
struct SensorAdapterTests {
    /// Two seconds of one pose at 50 Hz, both sensors, as Core Motion gives
    /// them: seconds since boot, g with up reading −1, rad/s.
    func motionRows(accel: SIMD3<Double>, gyro: SIMD3<Double> = .zero) -> [[String]] {
        let sink = MemorySink()
        let recorder = PhoneRecorder(platform: .iPhone, motion: true, sink: sink)
        let start: TimeInterval = 81_234.5
        for i in 0..<100 {
            let t = PhoneRecorder.nanoseconds(start + Double(i) * 0.02)
            recorder.gyro(nanoseconds: t, x: gyro.x, y: gyro.y, z: gyro.z)
            recorder.accel(nanoseconds: t, x: accel.x, y: accel.y, z: accel.z)
        }
        recorder.tick(nanoseconds: PhoneRecorder.nanoseconds(start + 1))
        recorder.finish()
        #expect(recorder.droppedLate == 0 && recorder.droppedUnpaired == 0)
        let lines = (String(bytes: sink.motion, encoding: .utf8) ?? "").split(separator: "\n").dropFirst()
        return lines.map { $0.split(separator: ",").map(String.init) }
    }

    /// ms, ax, ay, az of the first motion row.
    func pose(_ rows: [[String]]) -> [String] { Array(rows.first?.dropFirst().prefix(3) ?? []) }

    @Test func flatOnATableReadsPlusOneG() {
        let rows = motionRows(accel: [0, 0, -1])
        #expect(rows.count > 20)  // ~12 a second
        #expect(rows.allSatisfy { Array($0[1...3]) == ["0.0000", "0.0000", "1.0000"] })
    }

    @Test func rightSideDownReadsMinusOneOnX() {
        // Right side down: the phone's left (−x) points up.
        #expect(pose(motionRows(accel: [1, 0, 0])) == ["-1.0000", "0.0000", "0.0000"])
    }

    @Test func noseDownReadsMinusOneOnY() {
        #expect(pose(motionRows(accel: [0, 1, 0])) == ["0.0000", "-1.0000", "0.0000"])
    }

    @Test func rotationIsWrittenInDegreesASecond() {
        let row = motionRows(accel: [0, 0, -1], gyro: [1, -0.5, 0.25])[0]
        #expect(Array(row[4...6]) == ["57.30", "-28.65", "14.32"])
    }

    @Test func samplesKeepTheirOwnTime() {
        // Core Motion's 81234.5 s since boot → the core's t_ms.
        #expect(motionRows(accel: [0, 0, -1])[0][0] == "81234500")
    }

    @Test func liveValuesAreNotReadyYet() {
        let recorder = PhoneRecorder(platform: .iPhone, motion: true, sink: MemorySink())
        #expect(recorder.live.strokeRate == nil)
        #expect(recorder.live.distanceMetres == nil)
    }
}

/// When a fix was taken, on the uptime clock, and which fields count.
struct PhoneLocationTests {
    let now = Date(timeIntervalSince1970: 1_789_948_800)
    let uptime: TimeInterval = 98_765.25

    func fix(
        age: TimeInterval = 0.5, horizontal: Double = 5, vertical: Double = 3, speed: Double = 2.3,
        course: Double = 45
    ) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 51.46, longitude: -0.97), altitude: 38,
            horizontalAccuracy: horizontal, verticalAccuracy: vertical, course: course, speed: speed,
            timestamp: now.addingTimeInterval(-age))
    }

    @Test func aFixIsPlacedWhenItWasTaken() throws {
        let location = try #require(PhoneLocation(fix(age: 0.5), uptime: uptime, now: now))
        #expect(location.nanoseconds == 98_764_750_000_000)
        #expect(location.utcMilliseconds == 1_789_948_799_500)
        #expect(location.latitude == 51.46 && location.longitude == -0.97)
        #expect(location.altitude == 38 && location.speed == 2.3 && location.course == 45)
    }

    @Test func aCachedFixIsPlacedMinutesBack() throws {
        // So the layer sees it as over 3 s old: no fix.
        let location = try #require(PhoneLocation(fix(age: 600), uptime: uptime, now: now))
        #expect(location.nanoseconds == 98_165_250_000_000)
    }

    @Test func fieldsCoreLocationDidNotGiveAreLeftOut() throws {
        let location = try #require(PhoneLocation(fix(vertical: -1, speed: -1, course: -1), uptime: uptime, now: now))
        #expect(location.altitude == nil && location.speed == nil && location.course == nil)
        let zero = try #require(PhoneLocation(fix(vertical: 0, speed: 0, course: 0), uptime: uptime, now: now))
        #expect(zero.altitude == nil && zero.speed == 0 && zero.course == 0)
    }

    @Test func anInvalidPositionIsNotAFix() {
        #expect(PhoneLocation(fix(horizontal: -1), uptime: uptime, now: now) == nil)
    }
}

struct RecordingFilesTests {
    @Test func filesAreNamedAsTheTrackerNamesThem() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let start = Date(timeIntervalSince1970: 1_789_712_662)  // 2026-09-18 06:24:22 UTC
        let files = try RecordingFiles(directory: directory, start: start)
        #expect(files.track.lastPathComponent == "track_20260918_062422.csv")
        #expect(files.motion.lastPathComponent == "track_20260918_062422_i10.csv")
    }

    @Test func everyLineIsInTheFileAsSoonAsItIsWritten() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let files = try RecordingFiles(directory: directory, start: Date())
        let recorder = PhoneRecorder(platform: .iPhone, motion: true, sink: files)
        // Before finish or close: what a killed app leaves behind.
        let track = try String(contentsOf: files.track, encoding: .utf8)
        let motion = try String(contentsOf: files.motion, encoding: .utf8)
        #expect(track.hasPrefix("timestamp,ms,utc_date,") && track.hasSuffix("\n"))
        #expect(motion == "ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps\n")
        recorder.finish()
        try files.close(droppedLate: 2, droppedUnpaired: 1)
        #expect(
            try String(contentsOf: files.log, encoding: .utf8) == "dropped_late,2\ndropped_unpaired,1\nfailed_lines,0\n"
        )
    }

    @Test func aSecondRecordingInTheSameSecondGetsTheTrackersSuffix() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let start = Date(timeIntervalSince1970: 1_789_712_662)
        let first = try RecordingFiles(directory: directory, start: start)
        let second = try RecordingFiles(directory: directory, start: start)
        let third = try RecordingFiles(directory: directory, start: start)
        #expect(first.track.lastPathComponent == "track_20260918_062422.csv")
        #expect(second.track.lastPathComponent == "track_20260918_062422_1.csv")
        #expect(second.motion.lastPathComponent == "track_20260918_062422_1_i10.csv")
        #expect(third.track.lastPathComponent == "track_20260918_062422_2.csv")
    }

    /// The uploader never sends a track still being written: it's open from
    /// the moment the recording starts until its files close.
    @Test func aTrackIsOpenUntilItsFilesClose() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let files = try RecordingFiles(directory: directory, start: Date(timeIntervalSince1970: 1_789_712_662))
        #expect(RecordingFiles.isOpen(files.track))
        #expect(!RecordingFiles.isOpen(files.motion))
        try files.close(droppedLate: 0, droppedUnpaired: 0)
        #expect(!RecordingFiles.isOpen(files.track))
    }

    @Test func recordingsAreLeftOutOfBackups() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        _ = try RecordingFiles(directory: directory, start: Date())
        let values = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(values.isExcludedFromBackup == true)
    }
}

/// The core's GPS state through the binding, and the agreed words for it.
struct GPSLineTests {
    func live(_ fix: Bool, _ since: Float?) -> LiveValues {
        var values = LiveValues()
        values.hasFix = fix
        values.secondsSinceFix = since
        return values
    }

    @Test func theCoreSaysWhetherThereIsAFix() {
        let recorder = PhoneRecorder(platform: .iPhone, motion: false, sink: MemorySink())
        recorder.tick(nanoseconds: 10_000_000_000)
        #expect(!recorder.live.hasFix && recorder.live.secondsSinceFix == nil, "before the first fix")
        recorder.location(
            PhoneLocation(
                nanoseconds: 10_500_000_000, utcMilliseconds: 1_789_948_800_000, latitude: 51.46, longitude: -0.97))
        recorder.tick(nanoseconds: 11_000_000_000)
        #expect(recorder.live.hasFix && recorder.live.secondsSinceFix == 0)
        recorder.tick(nanoseconds: 14_000_000_000)  // the fix is 3.5 s old: none
        #expect(!recorder.live.hasFix)
        #expect((recorder.live.secondsSinceFix ?? 0) > 0)
    }

    @Test func theWordsForEachState() {
        // swiftlint:disable:next large_tuple
        let cases: [(LiveValues, String, String)] = [
            (live(false, nil), "Waiting for GPS", "Waiting for GPS"),
            (live(true, 0), "GPS fix", "GPS fix"),
            (live(false, 0), "GPS lost", "GPS lost"),
            (live(false, 0.9), "GPS lost", "GPS lost"),
            (live(false, 1), "GPS lost 1 s ago", "GPS lost 1 second ago"),
            (live(false, 40.7), "GPS lost 40 s ago", "GPS lost 40 seconds ago"),
            (live(false, 59.9), "GPS lost 59 s ago", "GPS lost 59 seconds ago"),
            (live(false, 60), "GPS lost 1 min ago", "GPS lost 1 minute ago"),
            (live(false, 179), "GPS lost 2 min ago", "GPS lost 2 minutes ago"),
            (live(false, 4500), "GPS lost 75 min ago", "GPS lost 75 minutes ago"),
        ]
        for (values, text, label) in cases {
            let line = GPSLine(values)
            #expect(line.text == text)
            #expect(line.label == label)
        }
    }

    @Test func announcedOnlyOnAChange() {
        #expect(GPSLine.announcement(before: live(false, nil), now: live(true, 0)) == nil, "the first fix")
        #expect(GPSLine.announcement(before: live(true, 0), now: live(false, 0)) == "GPS lost")
        #expect(GPSLine.announcement(before: live(false, 0), now: live(false, 30)) == nil)
        #expect(GPSLine.announcement(before: live(false, 30), now: live(true, 0)) == "GPS back")
        #expect(GPSLine.announcement(before: live(true, 0), now: live(true, 0)) == nil)
    }
}

struct FinishingTests {
    @Test func rowsStillHeldAreInTheFileWhenItCloses() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let files = try RecordingFiles(directory: directory, start: Date())
        let recorder = PhoneRecorder(platform: .iPhone, motion: true, sink: files)
        // Only the accelerometer: the layer holds the row for the gyroscope.
        for i in 0..<60 { recorder.accel(nanoseconds: 10_000_000_000 + Int64(i) * 20_000_000, x: 0, y: 0, z: -1) }
        recorder.tick(nanoseconds: 11_000_000_000)
        let before = try String(contentsOf: files.track, encoding: .utf8)
        #expect(before.split(separator: "\n").count == 1, "held: header only")
        try files.finish(recorder)
        let after = try String(contentsOf: files.track, encoding: .utf8)
        #expect(after.split(separator: "\n").count == 2, "the held row is written before the file closes")
        #expect(try String(contentsOf: files.log, encoding: .utf8).hasPrefix("dropped_late,"))
    }

    @Test func aWriteThatFailsIsKeptAndLaterLinesAreSkipped() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let files = try RecordingFiles(directory: directory, start: Date())
        try files.close(droppedLate: 0, droppedUnpaired: 0)
        files.write(Data("x\n".utf8), to: .track)
        #expect(files.failure != nil)
        files.write(Data("y\n".utf8), to: .motion)  // skipped, no crash
        #expect(try Data(contentsOf: files.motion).isEmpty)
        #expect(files.failedLines == 2, "the failed line and the one skipped after it")
    }
}
