import CoreGraphics
import Foundation
import RecorderCore

/// The live motion trace, as the recorder core returns it (`rc_phone_trace`,
/// recorder_core.h § Live motion trace): what the recording screen draws to
/// show the motion sensors work. The core decides everything; the app draws
/// it and works out nothing.
public struct MotionTrace: Sendable, Equatable {
    public enum Status: String, Sendable, CaseIterable {
        /// No sample yet, under 7 s into the recording. Nothing to draw.
        case starting
        /// None for 7 s. Nothing to draw.
        case noSamples = "no_samples"
        /// Samples arriving, the phone lying still.
        case still
        /// The sensors see movement.
        case motion
    }

    public struct Sample: Sendable, Equatable {
        /// Before the newest sample; the newest is 0.
        public let agoMilliseconds: UInt32
        /// Degrees a second about the mean, within ±`scaleDps`.
        public let dps: Float

        public init(agoMilliseconds: UInt32, dps: Float) {
            self.agoMilliseconds = agoMilliseconds
            self.dps = dps
        }
    }

    /// How far back the trace reaches, left edge to right.
    public static let span: UInt32 = 10_000

    public var status: Status
    /// The gyroscope axis drawn (0, 1, 2: x, y, z), nil when there are no
    /// samples.
    public var axis: Int?
    /// The trace's height: draw `dps` in ±`scaleDps`.
    public var scaleDps: Float
    /// Oldest first.
    public var samples: [Sample]

    public init(status: Status, axis: Int? = nil, scaleDps: Float = 5, samples: [Sample] = []) {
        self.status = status
        self.axis = axis
        self.scaleDps = scaleDps
        self.samples = samples
    }

    init(_ trace: rc_trace) {
        switch trace.status {
        case RC_TRACE_NO_SAMPLES: status = .noSamples
        case RC_TRACE_STILL: status = .still
        case RC_TRACE_MOTION: status = .motion
        default: status = .starting
        }
        axis = trace.axis < 0 ? nil : Int(trace.axis)
        scaleDps = trace.scale_dps
        let n = min(Int(trace.n), Int(RC_TRACE_MAX))
        let ago = withUnsafeBytes(of: trace.ago_ms) { Array($0.bindMemory(to: UInt32.self).prefix(n)) }
        let dps = withUnsafeBytes(of: trace.dps) { Array($0.bindMemory(to: Float.self).prefix(n)) }
        samples = zip(ago, dps).map { Sample(agoMilliseconds: $0, dps: $1) }
    }

    /// Where each sample goes in a box this size: the newest at the right
    /// edge, `span` back at the left, 0 deg/s in the middle and ±`scaleDps`
    /// `inset` in from the top and bottom (half the line's width, so the line
    /// isn't cut off). Joined as they are: no smoothing.
    public func points(in size: CGSize, inset: CGFloat) -> [CGPoint] {
        let middle = size.height / 2
        let reach = max(middle - inset, 0)
        return samples.map { sample in
            let x = size.width * (1 - CGFloat(sample.agoMilliseconds) / CGFloat(Self.span))
            let y = middle - reach * CGFloat(sample.dps / scaleDps)
            return CGPoint(x: x, y: y)
        }
    }
}

extension MotionTrace {
    /// As the core's fixtures write it (`trace.csv`, recorder-core/fixtures/
    /// README.md): `trace,<status>,<x|y|z|->,<n>,<scale_dps>`, then one
    /// `<ago_ms>,<dps>` line per sample.
    public var csv: String {
        var text = "trace,\(status.rawValue),\(axis.map { ["x", "y", "z"][$0] } ?? "-"),\(samples.count),"
        text += String(format: "%.2f\n", Double(scaleDps))
        for sample in samples {
            text += String(format: "%u,%.2f\n", sample.agoMilliseconds, Double(sample.dps))
        }
        return text
    }

    /// Reads one `csv` block. The UI tests hand the app a fixture's trace
    /// this way; nil if it isn't one.
    public init?(csv: String) {
        let lines = csv.split(separator: "\n").map { $0.split(separator: ",", omittingEmptySubsequences: false) }
        guard let head = lines.first, head.count == 5, head[0] == "trace",
            let status = Status(rawValue: String(head[1])), let n = Int(head[3]), let scale = Float(head[4]),
            lines.count == n + 1
        else { return nil }
        var samples: [Sample] = []
        for line in lines.dropFirst() {
            guard line.count == 2, let ago = UInt32(line[0]), let dps = Float(line[1]) else { return nil }
            samples.append(Sample(agoMilliseconds: ago, dps: dps))
        }
        self.init(
            status: status, axis: ["x", "y", "z"].firstIndex(of: String(head[2])), scaleDps: scale, samples: samples)
    }
}
