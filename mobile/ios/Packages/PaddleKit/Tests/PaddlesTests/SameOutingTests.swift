import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// mobile/contract/README.md, "Same outing".
@MainActor @Suite struct SameOutingTests {
    func links(_ source: ScriptedSource) async -> (PaddleDetailModel, [SameOutingLink]) {
        let model = PaddleDetailModel(id: "pdl-river", source: source)
        await model.load()
        return (model, model.sameOuting)
    }

    @Test func thePageLinksEachOtherRecording() async {
        let (_, links) = await links(ScriptedSource(sameOuting: "paddles.sameOuting"))
        #expect(links == [SameOutingLink(id: "pdl-phone2", sourceType: "device", phone: true)])
        #expect(links.first?.text == "Also recorded by the phone")
        #expect(links.first?.spoken == "Compare with the recording from the phone")
    }

    @Test func noOtherRecordingsShowNothing() async {
        let (model, links) = await links(ScriptedSource(sameOuting: "paddles.sameOuting.none"))
        #expect(links.isEmpty)
        #expect(model.state.value != nil)
    }

    @Test func aFailedCallShowsNothingAndThePageStays() async {
        let (model, links) = await links(ScriptedSource(sameOuting: nil))
        #expect(links.isEmpty)
        #expect(model.state.value != nil, "the links are extra, never an error on the page")
    }

    @Test func aTrackerRecordingIsTheTracker() {
        #expect(SameOutingLink(id: "b", sourceType: "device", phone: nil).text == "Also recorded by the tracker")
    }

    @Test func compareHasThePaddleOnScreenFirst() {
        #expect(
            SameOutingLink.comparePath(a: "pdl-tracker", b: "pdl-phone2")
                == "/paddles/compare?a=pdl-tracker&b=pdl-phone2")
    }

    /// The samples have no account to compare in.
    @Test func theSamplesHaveNoLinks() async throws {
        #expect(try await SamplePaddles(directory: fixtures).sameOuting(id: "pdl-river").isEmpty)
    }

    @Test func compareHasThePaddleOnScreenAsA() async {
        let asked = Asked()
        let opener = CompareOpener { path in
            await asked.add(path)
            return true
        }
        let phone = SameOutingLink(id: "pdl-phone2", sourceType: "device", phone: true)
        await opener.open(paddle: "pdl-tracker", link: phone)
        #expect(await asked.paths == ["/paddles/compare?a=pdl-tracker&b=pdl-phone2"])
        #expect(!opener.failed)
        #expect(opener.opening == nil)
    }

    /// Each web-code link works once: a second tap while the first asks
    /// asks nothing.
    @Test func aSecondTapWhileAskingAsksNothing() async {
        let asked = Asked()
        let release = AsyncStream<Void>.makeStream()
        let opener = CompareOpener { path in
            await asked.add(path)
            for await _ in release.stream { break }
            return true
        }
        let link = SameOutingLink(id: "b", sourceType: "strava", phone: nil)
        let first = Task { await opener.open(paddle: "a", link: link) }
        while await asked.paths.isEmpty { await Task.yield() }
        #expect(opener.opening == link, "a spinner on the tapped one")
        await opener.open(paddle: "a", link: link)
        await opener.open(paddle: "a", link: SameOutingLink(id: "c", sourceType: "file", phone: nil))
        release.continuation.yield()
        await first.value
        #expect(await asked.paths.count == 1)
        #expect(opener.opening == nil)
    }

    @Test func aFailedAskSaysSo() async {
        let opener = CompareOpener { _ in false }
        await opener.open(paddle: "a", link: SameOutingLink(id: "b", sourceType: "strava", phone: nil))
        #expect(opener.failed)
        #expect(opener.opening == nil, "it can be tried again")
    }
}

actor Asked {
    private(set) var paths: [String] = []
    func add(_ path: String) { paths.append(path) }
}
