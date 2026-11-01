import CoreLocation
import Observation

/// "While Using" location permission, with background location for a locked
/// screen (UIBackgroundModes), never "Always" (docs/features/ios-app.md).
@MainActor @Observable
final class LocationPermission: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<Bool, Never>?
    private(set) var denied = false
    /// Location Services are off for the whole phone (Settings, Privacy).
    private(set) var servicesOff = false
    /// Precise Location is off: the route would be kilometres out.
    private(set) var reducedAccuracy = false
    /// The system's question is up.
    private(set) var asking = false

    override init() {
        super.init()
        manager.delegate = self
        denied = Self.isDenied(manager.authorizationStatus)
        reducedAccuracy = manager.accuracyAuthorization == .reducedAccuracy
        checkServices()
    }

    /// True once recording may use the location.
    func ask() async -> Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return true
        case .notDetermined:
            guard waiting == nil else { return false }  // a second tap while asking
            asking = true
            defer { asking = false }
            return await withCheckedContinuation { continuation in
                waiting = continuation
                manager.requestWhenInUseAuthorization()
            }
        default:
            denied = true
            return false
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let reduced = manager.accuracyAuthorization == .reducedAccuracy
        Task { @MainActor in self.changed(status, reduced: reduced) }
    }

    private func changed(_ status: CLAuthorizationStatus, reduced: Bool) {
        denied = Self.isDenied(status)
        reducedAccuracy = reduced
        checkServices()
        guard status != .notDetermined, let waiting else { return }
        self.waiting = nil
        waiting.resume(returning: !denied)
    }

    /// Off the main thread: Apple says the answer can take a while. Turning
    /// them on or off also changes the authorization, which asks again.
    private func checkServices() {
        Task {
            let on = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
            servicesOff = !on
        }
    }

    private static func isDenied(_ status: CLAuthorizationStatus) -> Bool {
        status == .denied || status == .restricted
    }
}
