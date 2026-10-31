import Foundation
import RecorderCore

/// Which file a line goes in. The recorder core also has the tracker's raw
/// motion stream (never on a phone) and, from phase 4, stroke lines; neither
/// is written here.
public enum RecordingStream: Sendable, Equatable {
    /// `track_<stamp>.csv`: one row a second.
    case track
    /// `track_<stamp>_i10.csv`: motion, about 12 rows a second.
    case motion
}

/// Where a recording's lines go. Each line ends in a newline.
public protocol RecordingSink: AnyObject {
    func write(_ line: Data, to stream: RecordingStream)
}

/// One recording through the recorder core's phone layer
/// (`recorder-core/include/recorder_phone.h`). Hand it events as the platform
/// delivers them, in the platform's own units and clock. The layer converts,
/// orders, pairs, writes the rows and counts what it drops; nothing here
/// changes a value.
///
/// Not thread-safe, by design: the layer needs every call from one serial
/// queue, so whoever owns it keeps it on that queue.
public final class PhoneRecorder {
    public enum Platform: Sendable {
        /// Core Motion: acceleration in g, reading −1 at rest; rotation in rad/s.
        case iPhone
        /// Android's sensors (m/s², rad/s). Only for replaying the shared
        /// fixtures here.
        case android
    }

    private let phone: UnsafeMutablePointer<rc_phone>
    private let sink: RecordingSink

    /// Writes the header lines.
    /// - Parameters:
    ///   - motion: false for a phone without a gyroscope: rows aren't held
    ///     and sensor events are ignored.
    ///   - batteryMillivolts: true if ticks carry the battery's voltage.
    public init(platform: Platform, motion: Bool, batteryMillivolts: Bool = false, sink: RecordingSink) {
        self.sink = sink
        // About 100 KB: never on the stack.
        phone = UnsafeMutablePointer<rc_phone>.allocate(capacity: 1)
        var config = rc_phone_config()
        config.write = { user, stream, line, length in
            guard let user, let line else { return }
            let recorder = Unmanaged<PhoneRecorder>.fromOpaque(user).takeUnretainedValue()
            let target: RecordingStream
            switch stream {
            case RC_TRACK: target = .track
            case RC_MOTION: target = .motion
            default: return
            }
            recorder.sink.write(Data(bytes: line, count: length), to: target)
        }
        config.user = Unmanaged.passUnretained(self).toOpaque()
        config.platform = platform == .iPhone ? RC_PHONE_IOS : RC_PHONE_ANDROID
        config.has = batteryMillivolts ? UInt32(RC_HAS_BATT_MV) : 0
        config.motion = motion ? 1 : 0
        rc_phone_init(phone, &config)
    }

    deinit {
        phone.deallocate()
    }

    /// One accelerometer event. `nanoseconds` is the sample's own time on the
    /// monotonic clock (`Self.nanoseconds(_:)` of a `CMLogItem.timestamp`).
    public func accel(nanoseconds: Int64, x: Double, y: Double, z: Double) {
        rc_phone_accel(phone, nanoseconds, x, y, z)
    }

    /// One gyroscope event, rad/s.
    public func gyro(nanoseconds: Int64, x: Double, y: Double, z: Double) {
        rc_phone_gyro(phone, nanoseconds, x, y, z)
    }

    public func location(_ location: PhoneLocation) {
        var fix = rc_phone_location()
        fix.t_ns = location.nanoseconds
        fix.utc_ms = location.utcMilliseconds
        fix.lat = location.latitude
        fix.lon = location.longitude
        if let altitude = location.altitude {
            fix.alt_valid = 1
            fix.alt_m = altitude
        }
        if let speed = location.speed {
            fix.speed_valid = 1
            fix.speed_ms = speed
        }
        if let course = location.course {
            fix.course_valid = 1
            fix.course_deg = course
        }
        rc_phone_location_update(phone, &fix)
    }

    /// Asks for this second's row. Call it once a second, when the timer
    /// fires; never queue ticks.
    public func tick(nanoseconds: Int64, batteryMillivolts: UInt32 = 0) {
        rc_phone_tick(phone, nanoseconds, batteryMillivolts)
    }

    /// Writes everything still held. Call it before closing the files.
    public func finish() {
        rc_phone_finish(phone)
    }

    /// Arrived after their row was written.
    public var droppedLate: UInt32 { rc_phone_dropped_late(phone) }
    /// An accelerometer event with no gyroscope reading in the last 100 ms.
    public var droppedUnpaired: UInt32 { rc_phone_dropped_unpaired(phone) }

    /// What the recording screen shows now; nil until the core has a value.
    public var live: LiveValues {
        var values = rc_live_values()
        rc_phone_live(phone, &values)
        return LiveValues(values)
    }

    /// A Core Motion or uptime time in seconds, as the layer's nanoseconds.
    public static func nanoseconds(_ seconds: TimeInterval) -> Int64 {
        Int64(seconds * 1e9)
    }
}

/// The core's live values. nil means not ready: show "—", never a guess.
public struct LiveValues: Sendable, Equatable {
    public var strokeRate: Float?
    public var rollDegrees: Float?
    public var pitchDegrees: Float?
    public var evennessPercent: Float?
    public var speedKmh: Float?
    public var distanceMetres: Float?

    /// Nothing ready.
    public init() {}

    init(_ values: rc_live_values) {
        func ready(_ value: Float) -> Float? { value.isNaN ? nil : value }
        strokeRate = ready(values.spm)
        rollDegrees = ready(values.roll_deg)
        pitchDegrees = ready(values.pitch_deg)
        evennessPercent = ready(values.evenness_pct)
        speedKmh = ready(values.speed_kmh)
        distanceMetres = ready(values.distance_m)
    }
}
