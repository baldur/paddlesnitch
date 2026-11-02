import XCTest

/// The launch retry itself. Most launches here only record what XCTest said
/// on CI; one real launch of an app that isn't there checks that a real
/// failed launch comes back to the test.
@MainActor
final class LaunchingTests: XCTestCase {
    private func issue(_ text: String, type: XCTIssue.IssueType = .system) -> XCTIssue {
        XCTIssue(type: type, compactDescription: text)
    }

    private static let app = "<XCUIApplicationImpl: 0x109c66680 com.paddlesnitch.app at /Users/runner/Paddlesnitch.app>"

    /// The four CI failures, word for word (the xcresults' failure messages).
    private static let seenOnCI = [
        "Failed to launch \(app) via Xcode: Timed out while launching application via Xcode.",
        "Failed to get launch progress for \(app): Timed out while requesting launch progress.",
        "Failed to get background assertion for target app with pid 10040: Timed out while acquiring background assertion.",
    ]

    private let timeout = seenOnCI[2]

    func testEveryLaunchTimeoutSeenOnCIMatches() {
        for text in Self.seenOnCI {
            XCTAssertTrue(LaunchTimeout.matches(issue(text)), text)
        }
    }

    func testACrashAtLaunchIsNotATimeout() {
        let others = [
            "Failed to launch \(Self.app) via Xcode: The application crashed during launch.",
            "Failed to terminate com.paddlesnitch.app",
            "XCTAssertTrue failed",
        ]
        for text in others {
            XCTAssertFalse(LaunchTimeout.matches(issue(text)), text)
        }
    }

    func testALaunchThatWorksIsNotRepeated() {
        var launches = 0
        launchRetryingOnce { launches += 1 }
        XCTAssertEqual(launches, 1)
    }

    func testALaunchTimeoutIsTriedOnceMore() {
        var launches = 0
        launchRetryingOnce {
            launches += 1
            if launches == 1 { record(issue(timeout)) }
        }
        XCTAssertEqual(launches, 2)
    }

    func testASecondTimeoutStillFails() {
        var launches = 0
        XCTExpectFailure("the retry timed out too") {
            launchRetryingOnce {
                launches += 1
                record(issue(timeout))
            }
        }
        XCTAssertEqual(launches, 2, "one retry, not more")
    }

    func testAnyOtherFailureIsNotRetriedOrHidden() {
        var launches = 0
        XCTExpectFailure("not a launch timeout") {
            launchRetryingOnce {
                launches += 1
                record(issue("XCTAssertTrue failed", type: .assertionFailure))
            }
        }
        XCTAssertEqual(launches, 1)
    }

    /// The retry runs with the caller's setting, so its own failure still
    /// ends a test that stops on failure; and the setting comes back either way.
    func testItLeavesStopOnFailureAsItWas() {
        for stops in [true, false] {
            for timesOut in [true, false] {
                continueAfterFailure = !stops
                var seen: [Bool] = []
                launchRetryingOnce {
                    seen.append(continueAfterFailure)
                    if timesOut && seen.count == 1 { record(issue(timeout)) }
                }
                XCTAssertEqual(continueAfterFailure, !stops, "stops \(stops), times out \(timesOut)")
                if timesOut { XCTAssertEqual(seen.last, !stops, "the retry runs with the caller's setting") }
            }
        }
        continueAfterFailure = true
    }

    /// A real failed launch is an issue the test sees and comes back from,
    /// not an end to the test, when it doesn't stop on failure. The retry
    /// depends on this. (Not a timeout: an app that isn't installed.)
    func testARealFailedLaunchComesBackToTheTest() {
        continueAfterFailure = true
        let missing = XCUIApplication(bundleIdentifier: "com.paddlesnitch.not-installed")
        var cameBack = false
        let said = Said()
        let options = XCTExpectedFailure.Options()
        options.issueMatcher = { issue in
            said.text = issue.compactDescription
            return true
        }
        XCTExpectFailure("no such app", options: options) {
            missing.launch()
            cameBack = true
        }
        XCTAssertTrue(cameBack)
        XCTAssertFalse(said.text.isEmpty, "XCTest said why")
        XCTAssertFalse(LaunchTimeout.matches(issue(said.text)), "not a timeout: \(said.text)")
    }
}

/// What XCTest said, from its issue matcher.
private final class Said: @unchecked Sendable {
    var text = ""
}
