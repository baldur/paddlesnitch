import Testing

@testable import Account

@Suite struct DeleteAccountWordsTests {
    /// Trackers are removed, not "unlinked", and Strava isn't mentioned
    /// (lead, 2026-11-01).
    @Test func theTrackersAreRemoved() {
        #expect(DeleteAccountWords.explained.contains(" Your trackers are removed. "))
        #expect(!DeleteAccountWords.explained.localizedCaseInsensitiveContains("strava"))
        #expect(DeleteAccountWords.explained.hasSuffix("This happens at once and can’t be undone."))
    }
}
