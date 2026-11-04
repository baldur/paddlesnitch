import Observation

/// Moves between the tabs from deep in a screen: Boat motion's Open
/// tracker goes to You → Trackers, Open phone to the Paddles list
/// (mobile/contract/README.md, "Boat motion"). A request waits until the
/// tab's screen takes it: You may not have been shown yet.
@MainActor @Observable
final class AppNavigator {
    var tab = "paddles"
    /// You should show Trackers; You clears it when it does.
    var trackersWanted = false
    /// Paddles should go back to its list; it clears it when it does.
    var paddlesListWanted = false

    func openTrackers() {
        trackersWanted = true
        tab = "you"
    }

    func openPaddles() {
        paddlesListWanted = true
        tab = "paddles"
    }
}
