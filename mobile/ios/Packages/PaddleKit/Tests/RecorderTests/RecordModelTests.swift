import Foundation
import Recorder
import Testing

@MainActor
struct RecordModelTests {
    final class FakeRecording: RecordingHandle, @unchecked Sendable {
        var stopped = 0
        var stopFails = false
        func stop() throws {
            stopped += 1
            if stopFails { throw CocoaError(.fileWriteOutOfSpace) }
        }
    }

    final class Starter {
        let recording = FakeRecording()
        var send: (@MainActor @Sendable (RecordingStatus) -> Void)?
        var fails = false
        var starts = 0

        @MainActor func start(_ onStatus: @escaping @MainActor @Sendable (RecordingStatus) -> Void) throws -> (
            handle: RecordingHandle, name: String
        ) {
            starts += 1
            if fails { throw CocoaError(.fileWriteNoPermission) }
            send = onStatus
            return (recording, "track_20260918_062422.csv")
        }
    }

    @Test func recordsThenSavesUnderTheTrackersName() {
        let starter = Starter()
        let started = Date(timeIntervalSince1970: 1_789_712_662)
        let model = RecordModel(now: { started }, start: starter.start)
        #expect(model.startedAt == nil)
        model.record()
        #expect(model.phase == .recording)
        #expect(model.startedAt == started)
        model.record()  // a second tap starts nothing
        #expect(starter.starts == 1)
        model.stop()
        #expect(starter.recording.stopped == 1)
        #expect(model.phase == .saved("track_20260918_062422.csv"))
        #expect(model.problem == nil)
        model.done()
        #expect(model.phase == .ready)
    }

    @Test func doneDoesNothingWhileRecording() {
        let starter = Starter()
        let model = RecordModel(start: starter.start)
        model.record()
        model.done()
        #expect(model.phase == .recording)
        #expect(starter.recording.stopped == 0)
    }

    @Test func showsWhatTheCoreSends() {
        let starter = Starter()
        let model = RecordModel(start: starter.start)
        model.record()
        #expect(model.status.live.strokeRate == nil)  // "—"
        starter.send?(RecordingStatus(hasFix: true, droppedLate: 3))
        #expect(model.status.hasFix && model.status.droppedLate == 3)
        model.stop()
        starter.send?(RecordingStatus(hasFix: false))  // a tick that was already on its way
        #expect(model.status.hasFix)
    }

    @Test func saysSoWhenItCannotStart() {
        let starter = Starter()
        starter.fails = true
        let model = RecordModel(start: starter.start)
        model.record()
        #expect(model.phase == .ready)
        #expect(model.problem == "Couldn't start recording. Please try again.")
    }

    @Test func saysSoWhenThePhoneIsFull() {
        let starter = Starter()
        let model = RecordModel(start: starter.start)
        model.record()
        starter.send?(RecordingStatus(couldNotSave: true))
        #expect(model.problem == "Couldn't save any more of this recording. Stop to keep what's saved so far.")
    }

    @Test func aFailedCloseStillEndsTheRecording() {
        let starter = Starter()
        starter.recording.stopFails = true
        let model = RecordModel(start: starter.start)
        model.record()
        model.stop()
        #expect(model.phase == .saved("track_20260918_062422.csv"))
        #expect(model.problem?.hasPrefix("Couldn't finish saving") == true)
    }
}
