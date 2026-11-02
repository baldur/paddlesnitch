import XCTest

/// What XCTest says when the simulator is too slow to start the app. On CI
/// the first launch of a job hit this four times in two days (runs
/// 41346904604, 41367784572, 41371378132, 41387651281), always in
/// `AppTestCase.setUp()`, and each time the app went on to start and idle.
/// Every one said "Timed out while …". "Failed to launch" alone isn't
/// enough: a crash at launch says that too, and must not be retried.
enum LaunchTimeout {
    static let phrases = [
        "Timed out while launching application",
        "Timed out while requesting launch progress",
        "Timed out while acquiring background assertion",
    ]

    static func matches(_ issue: XCTIssue) -> Bool {
        let text = issue.compactDescription + "\n" + (issue.detailedDescription ?? "")
        return phrases.contains { text.contains($0) }
    }
}

/// Set from XCTest's issue matcher, read after the launch.
private final class Flag: @unchecked Sendable {
    var isSet = false
}

extension XCTestCase {
    /// Runs `launch`, and once more if the first try was a launch timeout.
    /// A timeout is kept as an expected failure (it still shows in the
    /// xcresult and the log's failure count). A second timeout, or any other
    /// failure, fails the test.
    @MainActor
    func launchRetryingOnce(_ launch: () -> Void) {
        let timedOut = Flag()
        let options = XCTExpectedFailure.Options()
        options.isStrict = false
        options.issueMatcher = { issue in
            guard LaunchTimeout.matches(issue) else { return false }
            timedOut.isSet = true
            return true
        }
        // A failed launch would otherwise end the test before the retry.
        let stopOnFailure = continueAfterFailure
        continueAfterFailure = true
        XCTExpectFailure("The simulator was too slow to start the app", options: options) { launch() }
        continueAfterFailure = stopOnFailure
        guard timedOut.isSet else { return }
        // As a warning, or xcbeautify drops it. CI logs are counted by this.
        print("\(#fileID):\(#line): warning: Launch timed out; launching again")
        XCTContext.runActivity(named: "Launch again after a launch timeout") { _ in launch() }
    }
}
