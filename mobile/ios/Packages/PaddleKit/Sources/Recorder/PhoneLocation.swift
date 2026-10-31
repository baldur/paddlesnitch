import CoreLocation
import Foundation

/// A fix as the recorder core's phone layer takes it: the time it was TAKEN on
/// the monotonic clock, its wall time, and only the fields the platform gave.
public struct PhoneLocation: Sendable, Equatable {
    public var nanoseconds: Int64
    public var utcMilliseconds: Int64
    public var latitude: Double
    public var longitude: Double
    public var altitude: Double?
    /// m/s
    public var speed: Double?
    /// Degrees from north.
    public var course: Double?

    public init(
        nanoseconds: Int64, utcMilliseconds: Int64, latitude: Double, longitude: Double,
        altitude: Double? = nil, speed: Double? = nil, course: Double? = nil
    ) {
        self.nanoseconds = nanoseconds
        self.utcMilliseconds = utcMilliseconds
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.speed = speed
        self.course = course
    }

    /// - Parameters:
    ///   - uptime: `ProcessInfo.systemUptime`, read as the fix is handled.
    ///   - now: the wall clock, read at the same moment.
    /// - Returns: nil when Core Location marks the position itself invalid
    ///   (horizontal accuracy below 0).
    ///
    /// The fix is placed at the moment it was taken, not when it arrived: the
    /// first one is often cached, minutes old, and must read as no fix.
    public init?(_ location: CLLocation, uptime: TimeInterval, now: Date) {
        guard location.horizontalAccuracy >= 0 else { return nil }
        let age = now.timeIntervalSince1970 - location.timestamp.timeIntervalSince1970
        nanoseconds = PhoneRecorder.nanoseconds(uptime - age)
        utcMilliseconds = Int64(location.timestamp.timeIntervalSince1970 * 1000)
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        altitude = location.verticalAccuracy > 0 ? location.altitude : nil
        speed = location.speed >= 0 ? location.speed : nil
        course = location.course >= 0 ? location.course : nil
    }
}
