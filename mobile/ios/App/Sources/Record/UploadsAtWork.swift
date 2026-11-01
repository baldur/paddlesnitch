import Network
import Observation
import PhoneUpload
import UIKit

/// Whether the phone has a network, any kind: uploads go on any network
/// (owner, 2026-11-01).
@MainActor @Observable
final class NetworkWatch {
    private(set) var online = true
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.online = online }
        }
        monitor.start(queue: DispatchQueue(label: "com.paddlesnitch.network"))
    }

    deinit {
        monitor.cancel()
    }
}

extension UploadQueue {
    /// Going into the background: the system gives the app a little while,
    /// so what's waiting gets that long to go. After that, the queue tries
    /// again when the app is back.
    func keepGoingInBackground() {
        let time = BackgroundTime()
        time.id = UIApplication.shared.beginBackgroundTask(withName: "Upload recordings") { time.end() }
        kick()
        Task {
            // Until nothing's going up, or the system's time is nearly out.
            for tick in 0..<50 {
                try? await Task.sleep(for: .milliseconds(500))
                if tick > 1 && !isUploading { break }
            }
            time.end()
        }
    }
}

/// The background time asked for, ended once.
@MainActor
private final class BackgroundTime {
    var id = UIBackgroundTaskIdentifier.invalid

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
