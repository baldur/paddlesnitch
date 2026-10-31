#if os(iOS)
    import CoreLocation
    import CoreMotion
    import Foundation

    /// A recording on this iPhone: Core Motion and Core Location into the
    /// recorder core's phone layer, its lines into the files.
    ///
    /// Every call into the layer runs on one serial queue, as it requires:
    /// Core Motion's handlers, each location (hopped there), and the 1 s tick.
    /// The sensors come as `CMAccelerometerData` and `CMGyroData` (raw,
    /// gravity included), not `CMDeviceMotion`, untouched.
    ///
    /// Carries on with the screen off on "While Using" permission: the
    /// `location` background mode plus a background activity session.
    public final class PhoneRecording: RecordingHandle, @unchecked Sendable {
        public let files: RecordingFiles

        // Touched only on `queue` (its operations run on `dispatch`).
        private let dispatch = DispatchQueue(label: "com.paddlesnitch.recording")
        private let queue = OperationQueue()
        private let motion = CMMotionManager()
        private var recorder: PhoneRecorder?
        private var timer: DispatchSourceTimer?
        private var locations: Task<Void, Never>?
        private var background: CLBackgroundActivitySession?
        private let onStatus: @MainActor @Sendable (RecordingStatus) -> Void

        /// Starts recording at once. Ask for location permission first.
        public init(directory: URL, onStatus: @escaping @MainActor @Sendable (RecordingStatus) -> Void) throws {
            files = try RecordingFiles(directory: directory, start: Date())
            self.onStatus = onStatus
            queue.maxConcurrentOperationCount = 1
            queue.underlyingQueue = dispatch
            dispatch.sync { start() }
        }

        /// Ends the recording: the sensors stop, everything held is written,
        /// and the files are closed.
        public func stop() throws {
            try dispatch.sync {
                guard let recorder else { return }
                self.recorder = nil  // handlers already queued now do nothing
                motion.stopAccelerometerUpdates()
                motion.stopGyroUpdates()
                timer?.cancel()
                locations?.cancel()
                background?.invalidate()
                try files.finish(recorder)
            }
        }

        private func start() {
            let sensors = motion.isAccelerometerAvailable && motion.isGyroAvailable
            let recorder = PhoneRecorder(platform: .iPhone, motion: sensors, sink: files)
            self.recorder = recorder
            if sensors {
                motion.accelerometerUpdateInterval = 0.02
                motion.gyroUpdateInterval = 0.02
                motion.startGyroUpdates(to: queue) { [weak self] data, _ in
                    guard let data, let recorder = self?.recorder else { return }
                    let r = data.rotationRate
                    recorder.gyro(nanoseconds: PhoneRecorder.nanoseconds(data.timestamp), x: r.x, y: r.y, z: r.z)
                }
                motion.startAccelerometerUpdates(to: queue) { [weak self] data, _ in
                    guard let data, let recorder = self?.recorder else { return }
                    let a = data.acceleration
                    recorder.accel(nanoseconds: PhoneRecorder.nanoseconds(data.timestamp), x: a.x, y: a.y, z: a.z)
                }
            }
            background = CLBackgroundActivitySession()
            // Holds the recording until stop() cancels it.
            locations = Task { [self, queue] in
                do {
                    for try await update in CLLocationUpdate.liveUpdates(.fitness) {
                        guard let location = update.location else { continue }
                        queue.addOperation { self.received(location) }
                    }
                } catch {}
            }
            let timer = DispatchSource.makeTimerSource(queue: dispatch)
            timer.schedule(deadline: .now() + 1, repeating: 1)
            timer.setEventHandler { [weak self] in self?.tick() }
            timer.resume()
            self.timer = timer
        }

        private func received(_ location: CLLocation) {
            // Uptime and wall clock read together, as the fix is handled.
            let uptime = ProcessInfo.processInfo.systemUptime
            guard let recorder, let fix = PhoneLocation(location, uptime: uptime, now: Date()) else { return }
            recorder.location(fix)
        }

        private func tick() {
            guard let recorder else { return }
            recorder.tick(nanoseconds: PhoneRecorder.nanoseconds(ProcessInfo.processInfo.systemUptime))
            let status = RecordingStatus(
                live: recorder.live, droppedLate: recorder.droppedLate,
                droppedUnpaired: recorder.droppedUnpaired, couldNotSave: files.failure != nil)
            let onStatus = onStatus
            // In order, unlike a Task each.
            DispatchQueue.main.async { MainActor.assumeIsolated { onStatus(status) } }
        }
    }
#endif
