import DesignSystem
import Observation
import Recorder
import SwiftUI

/// The recording on this phone, owned by RootView: it outlives its screen
/// (Hide), a tab change and a sign-out the app makes on its own (a refused
/// refresh), and stays in the account it started in.
@MainActor @Observable
final class RecordingSession {
    private(set) var model: RecordModel?
    var showing = false
    /// The account folder it writes to.
    private(set) var folder: URL?

    var isRecording: Bool { model?.phase == .recording }

    /// Opens the record screen: the running recording, or a new one in
    /// `folder` (the signed-in account's own), fixed now.
    func open(in folder: URL?) {
        if !isRecording {
            guard let folder else { return }
            self.folder = folder
            model = RecordModel(
                announce: { AccessibilityNotification.Announcement($0).post() },
                start: { onStatus in
                    let recording = try PhoneRecording(directory: folder, onStatus: onStatus)
                    return (recording, recording.files.track.lastPathComponent)
                })
        }
        showing = true
    }

    /// The signed-in account changed. A recording ends when its account was
    /// deleted (its files go too) or another account signed in; a sign-out
    /// alone keeps it.
    func accountChanged(to current: URL?) {
        guard isRecording, let folder else { return }
        let deleted = !FileManager.default.fileExists(atPath: folder.path(percentEncoded: false))
        guard deleted || (current != nil && current != folder) else { return }
        showing = false
        model?.stop()
        model?.done()
        if deleted { try? FileManager.default.removeItem(at: folder) }
    }
}

extension View {
    /// "Recording · h:mm:ss" at the top of every screen while the record
    /// screen is hidden, and the screen itself.
    func recording(_ session: RecordingSession, starting: @escaping () -> Void) -> some View {
        @Bindable var session = session
        return
            self
            .safeAreaInset(edge: .top, spacing: 0) {
                if session.isRecording, !session.showing, let started = session.model?.startedAt {
                    RecordingLine(startedAt: started) { session.showing = true }
                        .padding(.horizontal, 16)
                        .background(Palette.surface)
                }
            }
            // Presented from the root, not from the Record button: a sign-out
            // the app makes on its own takes the button away, and would take
            // the screen and its Stop with it.
            .fullScreenCover(isPresented: $session.showing) {
                if let model = session.model { RecordView(model: model, starting: starting) }
            }
    }
}
