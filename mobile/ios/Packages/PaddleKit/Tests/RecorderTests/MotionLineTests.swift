import CoreGraphics
import Foundation
import Recorder
import Testing

/// The status line's words under the trace, when they're announced, and
/// where the trace's samples go (mobile/contract/README.md § Motion line).
struct MotionLineTests {
    @Test func theWordsForEachStatus() {
        #expect(MotionLine(.starting).text == "Starting motion sensor")
        #expect(MotionLine(.motion).text == "Motion sensor working")
        #expect(MotionLine(.still).text == "Motion sensor working, phone still")
        #expect(MotionLine(.noSamples).text == "Couldn’t read the motion sensor. Stroke rate pauses until it’s back.")
    }

    @Test func onlyNoSamplesIsAWarning() {
        for status in MotionTrace.Status.allCases {
            #expect(MotionLine(status).isWarning == (status == .noSamples), "\(status)")
        }
    }

    @Test func announcedOnEnteringAndLeavingNoSamplesOnly() {
        func trace(_ status: MotionTrace.Status) -> MotionTrace { MotionTrace(status: status) }
        let lost = "Couldn’t read the motion sensor. Stroke rate pauses until it’s back."
        #expect(MotionLine.announcement(before: nil, now: trace(.starting)) == nil)
        #expect(MotionLine.announcement(before: trace(.starting), now: trace(.motion)) == nil)
        #expect(MotionLine.announcement(before: trace(.motion), now: trace(.still)) == nil)
        #expect(MotionLine.announcement(before: trace(.still), now: trace(.noSamples)) == lost)
        #expect(MotionLine.announcement(before: trace(.starting), now: trace(.noSamples)) == lost)
        #expect(MotionLine.announcement(before: trace(.noSamples), now: trace(.noSamples)) == nil)
        #expect(MotionLine.announcement(before: trace(.noSamples), now: trace(.motion)) == "Motion sensor back")
        #expect(MotionLine.announcement(before: trace(.noSamples), now: trace(.still)) == "Motion sensor back")
        // No motion sensors: no trace, nothing said.
        #expect(MotionLine.announcement(before: nil, now: nil) == nil)
    }

    /// Newest at the right edge, 10 s back at the left; 0 in the middle and
    /// ±scale half the line's width in from the edges.
    @Test func whereEachSampleGoes() {
        let trace = MotionTrace(
            status: .motion, axis: 1, scaleDps: 20,
            samples: [
                .init(agoMilliseconds: 10_000, dps: 20), .init(agoMilliseconds: 5_000, dps: 0),
                .init(agoMilliseconds: 0, dps: -20),
            ])
        let points = trace.points(in: CGSize(width: 300, height: 48), inset: 1)
        #expect(points == [CGPoint(x: 0, y: 1), CGPoint(x: 150, y: 24), CGPoint(x: 300, y: 47)])
        #expect(MotionTrace(status: .starting).points(in: CGSize(width: 300, height: 48), inset: 1).isEmpty)
    }

    @Test func theCoreTracesOnlyARecordingWithMotion() {
        let recorder = PhoneRecorder(platform: .iPhone, motion: true, sink: MemorySink())
        #expect(recorder.trace == MotionTrace(status: .starting, axis: nil, scaleDps: 5), "before any sample")
    }
}
